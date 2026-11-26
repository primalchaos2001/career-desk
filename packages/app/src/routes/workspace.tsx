import { createFileRoute } from "@tanstack/react-router";
import { CareerWorkspace } from "../components/CareerWorkspace";

export const Route = createFileRoute("/workspace")({ component: CareerWorkspace });
