import type { ResourceComponentStatus } from "@/bindings/downloads";

/** Selecting a component includes its dependencies; removing one also removes its dependents. */
export function selectComponents(
  components: ResourceComponentStatus[],
  selected: string[],
  id: string,
  checked: boolean,
): string[] {
  const next = new Set(selected);
  if (checked) {
    const include = (componentId: string) => {
      if (next.has(componentId)) return;
      next.add(componentId);
      components.find((component) => component.id === componentId)?.requires.forEach(include);
    };

    include(id);
  } else {
    next.delete(id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const component of components) {
        if (next.has(component.id) && component.requires.some((required) => !next.has(required))) {
          next.delete(component.id);
          changed = true;
        }
      }
    }
  }
  return components.filter((component) => next.has(component.id)).map((component) => component.id);
}

export function initialComponents(
  components: ResourceComponentStatus[],
  requested?: string[],
): string[] {
  if (requested?.length) {
    return components
      .filter((component) => requested.includes(component.id))
      .map((component) => component.id);
  }
  const installed = components.filter((component) => component.installed);
  return (
    installed.length ? installed : components.filter((component) => !component.requires.length)
  ).map((component) => component.id);
}
