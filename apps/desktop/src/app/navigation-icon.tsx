import { BookOpen, Clapperboard, Images, Layers, Settings, WandSparkles } from "lucide-react";

const icons = {
  create: WandSparkles,
  director: Clapperboard,
  gallery: Images,
  library: Layers,
  lexicon: BookOpen,
  settings: Settings,
};

/** Keep navigation symbols consistent during startup and in the workspace. */
export function NavigationIcon({ page }: { page: keyof typeof icons }) {
  const Icon = icons[page];
  return <Icon size={20} aria-hidden />;
}
