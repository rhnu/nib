//! Native `WebView` editing preserves the focused control's selection and undo history.

/// Dispatches only the application's fixed editing shortcuts to its own `WebView`.
#[tauri::command]
pub(crate) async fn edit_text(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    let result = dispatch_edit(window, &action).await;
    if let Err(error) = &result {
        tracing::warn!(action, error, "WebView editing command failed");
    }
    result
}

async fn dispatch_edit(window: tauri::WebviewWindow, action: &str) -> Result<(), String> {
    let (key, code, virtual_key, modifiers) = match action {
        "undo" => ("z", "KeyZ", 90, 2),
        "redo" => ("y", "KeyY", 89, 2),
        "cut" => ("x", "KeyX", 88, 2),
        "copy" => ("c", "KeyC", 67, 2),
        "paste" => ("v", "KeyV", 86, 2),
        "selectAll" => ("a", "KeyA", 65, 2),
        _ => return Err("Unknown editing action".to_owned()),
    };
    #[cfg(windows)]
    {
        use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};
        for event_type in ["rawKeyDown", "keyUp"] {
            let parameters = serde_json::json!({
                "type": event_type, "key": key, "code": code,
                "windowsVirtualKeyCode": virtual_key, "modifiers": modifiers,
            })
            .to_string();
            let (dispatch_tx, dispatch_rx) = tokio::sync::oneshot::channel();
            window
                .with_webview(move |webview| {
                    let started = (|| {
                        let (completed_tx, completed_rx) = tokio::sync::oneshot::channel();
                        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                            move |result, _| {
                                drop(completed_tx.send(result.map_err(|error| error.to_string())));
                                Ok(())
                            },
                        ));
                        let method = CoTaskMemPWSTR::from("Input.dispatchKeyEvent");
                        let parameters = CoTaskMemPWSTR::from(parameters.as_str());
                        #[expect(
                            unsafe_code,
                            reason = "WebView2 COM methods require an explicit unsafe call"
                        )]
                        // SAFETY: Tauri runs this closure on the WebView UI thread and owns
                        // the live controller for this closure's lifetime.
                        let view = unsafe { webview.controller().CoreWebView2() }
                            .map_err(|error| error.to_string())?;
                        #[expect(
                            unsafe_code,
                            reason = "WebView2 COM methods require an explicit unsafe call"
                        )]
                        // SAFETY: UTF-16 buffers remain alive through this COM call, and
                        // WebView2 retains the completion handler until it reports the result.
                        unsafe {
                            view.CallDevToolsProtocolMethod(
                                *method.as_ref().as_pcwstr(),
                                *parameters.as_ref().as_pcwstr(),
                                &handler,
                            )
                        }
                        .map_err(|error| error.to_string())?;
                        Ok::<_, String>(completed_rx)
                    })();
                    drop(dispatch_tx.send(started));
                })
                .map_err(|error| error.to_string())?;
            let completed = dispatch_rx.await.map_err(|error| error.to_string())??;
            completed.await.map_err(|error| error.to_string())??;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, key, code, virtual_key, modifiers);
        Err("Native editing is currently supported on Windows only".to_owned())
    }
}
