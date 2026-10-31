import { createContext } from "react";

/** The active surface supplies the same save/mask/resource checks for close and update. */
export class ExitPreparation {
  private prepare: (() => Promise<boolean>) | null = null;

  register(prepare: () => Promise<boolean>) {
    this.prepare = prepare;
    return () => {
      if (this.prepare === prepare) this.prepare = null;
    };
  }

  async run(): Promise<boolean> {
    return this.prepare ? this.prepare() : false;
  }
}

export const ExitPreparationContext = createContext<ExitPreparation | null>(null);
