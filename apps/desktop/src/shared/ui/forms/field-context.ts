import { createContext, useContext } from "react";

export const FieldAssociation = createContext<{
  controlId: string;
  labelId?: string;
  describedBy?: string;
  invalid: boolean;
  required?: boolean;
} | null>(null);

/** Native multiline inputs share the association maintained by their field. */
export function useFieldAssociation() {
  return useContext(FieldAssociation);
}
