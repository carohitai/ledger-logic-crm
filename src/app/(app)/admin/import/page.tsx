import { getLinkStatus } from "@/lib/graph";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const link = await getLinkStatus();
  return <ImportForm link={link} />;
}
