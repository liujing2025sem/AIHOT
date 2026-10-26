import { defineModule } from "../../packages/contracts/src/modules.ts";

export default defineModule({ name: "agent-harness", apiPaths: [/^\/api\/admin\/agent-harness(?:\/|$)/] });
