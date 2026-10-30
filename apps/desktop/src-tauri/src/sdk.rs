//! HTTP transport adapter selected by the desktop host.

use std::sync::Arc;

use nib_app::sdk::TransportFactory;
use novelai_bridge::{
    ApiKeySource, BridgeError, ReqwestOptions, ReqwestTransport, SecretString, Transport,
};

pub(crate) struct ReqwestTransportFactory;

impl TransportFactory for ReqwestTransportFactory {
    fn create(&self, key: SecretString) -> Result<Arc<dyn Transport>, BridgeError> {
        Ok(Arc::new(ReqwestTransport::new(ReqwestOptions {
            api_key_source: ApiKeySource::Inline { value: key },
            ..ReqwestOptions::default()
        })?))
    }
}
