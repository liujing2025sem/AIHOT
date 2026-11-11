import { redirect } from "react-router";
import { webModules } from "../../site-modules";

/** Installed modules retain their landing route; the original editorial desk has its own home. */
export function loader() {
  throw redirect(webModules().find((m) => m.admin?.landing)?.admin?.landing ?? "/admin/workbench");
}

export default function AdminIndex() {
  return null;
}
