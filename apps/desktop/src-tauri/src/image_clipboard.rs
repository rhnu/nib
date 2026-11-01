//! Native image and file clipboard representations share the same encoded source.

#[cfg(windows)]
pub(crate) use windows::copy_image;

#[cfg(not(windows))]
pub(crate) fn copy_image(_bytes: &[u8], _extension: &str) -> anyhow::Result<()> {
    anyhow::bail!("image clipboard is only supported on Windows")
}

#[cfg(windows)]
mod windows {
    use std::{
        borrow::Cow,
        fs,
        io::{Cursor, ErrorKind},
        path::PathBuf,
        sync::{Mutex, mpsc},
        thread,
        time::Duration,
    };

    use anyhow::{Context as _, anyhow, bail};
    use clipboard_win::{Clipboard, formats, options::NoClear, raw};
    use image::{DynamicImage, ImageDecoder as _, ImageFormat, ImageReader};

    static CLEANUP: Mutex<Option<mpsc::Sender<TemporaryImage>>> = Mutex::new(None);

    /// Publish exact encoded bytes as a file and decoded pixels as image formats.
    pub(crate) fn copy_image(bytes: &[u8], extension: &str) -> anyhow::Result<()> {
        let format = match extension {
            "png" => ImageFormat::Png,
            "jpg" | "jpeg" => ImageFormat::Jpeg,
            "webp" => ImageFormat::WebP,
            _ => bail!("unsupported clipboard image extension: {extension}"),
        };
        let mut decoder = ImageReader::with_format(Cursor::new(bytes), format)
            .into_decoder()
            .context("open clipboard image decoder")?;
        let orientation = decoder
            .orientation()
            .context("read clipboard image orientation")?;
        let mut pixels = DynamicImage::from_decoder(decoder).context("decode clipboard image")?;
        // Pixel formats lose source EXIF, so apply its display transform before encoding.
        pixels.apply_orientation(orientation);
        let png = if format == ImageFormat::Png {
            // Registered PNG and the file both retain original PNG text and other chunks.
            Cow::Borrowed(bytes)
        } else {
            let mut png = Cursor::new(Vec::new());
            pixels
                .write_to(&mut png, ImageFormat::Png)
                .context("encode clipboard PNG pixels")?;
            Cow::Owned(png.into_inner())
        };
        let mut bitmap = Cursor::new(Vec::new());
        pixels
            .to_rgb8()
            .write_to(&mut bitmap, ImageFormat::Bmp)
            .context("encode clipboard bitmap pixels")?;

        let cleanup = cleanup_sender()?;
        let temporary = TemporaryImage::create(bytes, extension)?;
        let result = publish(&temporary, &png, bitmap.get_ref());
        if let Err(error) = result {
            temporary.remove();
            return Err(error);
        }
        if let Err(error) = cleanup.send(temporary) {
            // A published CF_HDROP must stay usable even if its cleanup worker stopped.
            tracing::warn!(path = %error.0.file.display(), "clipboard cleanup worker stopped; retaining image file");
        }
        tracing::debug!(
            extension,
            bytes = bytes.len(),
            "copied image and encoded file to clipboard"
        );
        Ok(())
    }

    /// Set every representation while holding one clipboard lock; publish the file last.
    fn publish(temporary: &TemporaryImage, png: &[u8], bitmap: &[u8]) -> anyhow::Result<()> {
        let file = temporary
            .file
            .to_str()
            .context("clipboard temporary path is not valid Unicode")?;
        let png_format =
            raw::register_format("PNG").ok_or_else(|| anyhow!("register clipboard PNG format"))?;
        // BMP's 14-byte file header precedes the DIB header and pixel data.
        let dib = bitmap
            .get(14..)
            .context("missing clipboard bitmap header")?;
        let _clipboard = Clipboard::new_attempts(10).context("open image clipboard")?;
        raw::empty().context("clear image clipboard")?;
        raw::set_without_clear(png_format.get(), png).context("write clipboard PNG")?;
        raw::set_without_clear(formats::CF_DIB, dib).context("write clipboard bitmap")?;
        // No later fallible write may delete the file after CF_HDROP has been published.
        raw::set_file_list_with(&[file], NoClear).context("write clipboard image file")?;
        Ok(())
    }

    /// An exclusively created directory owns exactly one encoded image file.
    struct TemporaryImage {
        directory: PathBuf,
        file: PathBuf,
    }

    impl TemporaryImage {
        fn create(bytes: &[u8], extension: &str) -> anyhow::Result<Self> {
            let directory =
                std::env::temp_dir().join(format!("nib-clipboard-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&directory).context("create clipboard image directory")?;
            let temporary = Self {
                file: directory.join(format!("image.{extension}")),
                directory,
            };
            if let Err(error) = fs::write(&temporary.file, bytes) {
                temporary.remove();
                return Err(error).context("write clipboard image file");
            }
            Ok(temporary)
        }

        fn remove(self) {
            // Never recurse or enumerate temp directories: remove only our exact file and
            // its exclusively created, now-empty parent. Unrelated entries prevent removal.
            if let Err(error) = fs::remove_file(&self.file)
                && error.kind() != ErrorKind::NotFound
            {
                tracing::warn!(path = %self.file.display(), %error, "failed to remove clipboard image file");
                return;
            }
            if let Err(error) = fs::remove_dir(&self.directory)
                && error.kind() != ErrorKind::NotFound
            {
                tracing::warn!(path = %self.directory.display(), %error, "failed to remove clipboard image directory");
            }
        }
    }

    /// A single worker retains files until the current clipboard no longer references them.
    fn cleanup_sender() -> anyhow::Result<mpsc::Sender<TemporaryImage>> {
        let mut worker = CLEANUP
            .lock()
            .map_err(|_poisoned| anyhow!("clipboard cleanup state lock poisoned"))?;
        if let Some(sender) = worker.as_ref() {
            return Ok(sender.clone());
        }
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name("nib-clipboard-cleanup".into())
            .spawn(move || cleanup_files(&receiver))
            .context("start clipboard image cleanup worker")?;
        *worker = Some(sender.clone());
        Ok(sender)
    }

    fn cleanup_files(receiver: &mpsc::Receiver<TemporaryImage>) {
        let mut retained = Vec::<TemporaryImage>::new();
        loop {
            if retained.is_empty() {
                match receiver.recv() {
                    Ok(temporary) => retained.push(temporary),
                    Err(_) => return,
                }
            } else {
                match receiver.recv_timeout(Duration::from_secs(1)) {
                    Ok(temporary) => retained.push(temporary),
                    Err(mpsc::RecvTimeoutError::Timeout) => {},
                    // Do not remove files on process shutdown while CF_HDROP may need them.
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            let Some(paths) = clipboard_files() else {
                continue;
            };
            let mut current = Vec::new();
            for temporary in retained.drain(..) {
                if paths.contains(&temporary.file) {
                    current.push(temporary);
                } else {
                    temporary.remove();
                }
            }
            retained = current;
        }
    }

    /// A busy or unreadable clipboard preserves files until a later successful read.
    fn clipboard_files() -> Option<Vec<PathBuf>> {
        let _clipboard = Clipboard::new().ok()?;
        let mut files = Vec::new();
        if raw::is_format_avail(formats::CF_HDROP)
            && let Err(error) = raw::get_file_list_path(&mut files)
        {
            tracing::debug!(%error, "could not read clipboard file references; retaining temporary images");
            return None;
        }
        Some(files)
    }
}
