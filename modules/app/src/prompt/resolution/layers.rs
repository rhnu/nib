//! Ordered recipe contributions share one accumulation state with draft-local outputs.

use super::{
    CharacterComposition, Composition, Context, GenerationSettings, InputProvenance,
    InstanceOverride, PersistenceError, PresetBinding, PresetInstance, PresetOutputOverrides,
    ReferenceInputs, ResolutionIssue, ResolvedCharacter, ResolvedFragment, ResourceContent,
    ResourceReader, SettingSource, SettingsProvenance, lookup, resolve_composition,
    resolve_outputs, stale_output_overrides,
};

#[derive(Default)]
pub(super) struct ResolutionState {
    pub(super) fragments: Vec<ResolvedFragment>,
    pub(super) issues: Vec<ResolutionIssue>,
    pub(super) settings: GenerationSettings,
    pub(super) characters: Vec<ResolvedCharacter>,
    pub(super) references: ReferenceInputs,
    pub(super) input_sources: Vec<InputProvenance>,
    pub(super) provenance: SettingsProvenance,
}

struct PresetLayer<'a> {
    composition: &'a Composition,
    defaults: &'a GenerationSettings,
    characters: &'a [CharacterComposition],
    references: &'a ReferenceInputs,
    overrides: &'a [InstanceOverride],
    output_overrides: &'a PresetOutputOverrides,
    context: Context<'a>,
    name: &'a str,
}

impl ResolutionState {
    pub(super) fn resolve_preset(
        &mut self,
        instance: &PresetInstance,
        reader: &(impl ResourceReader + ?Sized),
    ) -> Result<(), PersistenceError> {
        let context = Context {
            instance_id: Some(&instance.id),
            ..Context::default()
        };
        match &instance.binding {
            PresetBinding::Linked {
                resource_id,
                overrides,
                output_overrides,
            } => {
                let Some(resource) = lookup(
                    resource_id,
                    true,
                    None,
                    None,
                    context,
                    reader,
                    &mut self.issues,
                )?
                else {
                    return Ok(());
                };
                let ResourceContent::Preset {
                    composition,
                    defaults,
                    characters,
                    references,
                } = &resource.content
                else {
                    unreachable!("lookup checks resource kind")
                };
                self.apply_layer(
                    &PresetLayer {
                        composition,
                        defaults,
                        characters,
                        references,
                        overrides,
                        output_overrides,
                        context: Context {
                            resource: Some(&resource),
                            ..context
                        },
                        name: &resource.name,
                    },
                    reader,
                )?;
            },
            PresetBinding::Expanded {
                name,
                composition,
                defaults,
                characters,
                references,
            } => {
                self.apply_layer(
                    &PresetLayer {
                        composition,
                        defaults,
                        characters,
                        references,
                        overrides: &[],
                        output_overrides: &PresetOutputOverrides::default(),
                        context: Context {
                            expanded: true,
                            ..context
                        },
                        name,
                    },
                    reader,
                )?;
            },
        }
        Ok(())
    }

    fn apply_layer(
        &mut self,
        layer: &PresetLayer<'_>,
        reader: &(impl ResourceReader + ?Sized),
    ) -> Result<(), PersistenceError> {
        stale_output_overrides(
            layer.composition,
            layer.characters,
            layer.overrides,
            layer.context,
            &mut self.issues,
        );
        resolve_outputs(
            layer.characters,
            layer.references,
            layer.output_overrides,
            layer.overrides,
            layer.context,
            reader,
            &mut self.characters,
            &mut self.references,
            &mut self.input_sources,
            &mut self.issues,
        )?;
        resolve_composition(
            layer.composition,
            layer.overrides,
            layer.context,
            reader,
            &mut self.fragments,
            &mut self.issues,
        )?;
        self.settings.overlay(
            layer.defaults,
            &mut self.provenance,
            &SettingSource::Preset {
                preset_instance_id: layer
                    .context
                    .instance_id
                    .expect("every recipe layer belongs to a preset instance")
                    .into(),
                resource_id: layer.context.resource.map(|resource| resource.id.clone()),
                name: layer.name.into(),
                expanded: layer.context.expanded,
            },
        );
        Ok(())
    }
}
