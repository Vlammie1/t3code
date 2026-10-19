import type { EnvironmentMachineKind } from "@t3tools/contracts";
import {
  type AppIconProps,
  CloudIcon,
  DesktopTowerIcon,
  HardDriveIcon,
  LaptopIcon,
  MonitorIcon,
  ServerIcon,
} from "~/components/appIcons";
import type { FunctionComponent } from "react";
import { LinuxIcon } from "./Icons";

const ICON_BY_KIND: Record<EnvironmentMachineKind, FunctionComponent<AppIconProps>> = {
  server: ServerIcon,
  cloud: CloudIcon,
  linux: LinuxIcon,
  desktop: MonitorIcon,
  laptop: LaptopIcon,
  "mac-mini": HardDriveIcon,
  "mac-studio": DesktopTowerIcon,
};

export const ENVIRONMENT_MACHINE_KIND_LABELS: Record<EnvironmentMachineKind, string> = {
  server: "Server",
  cloud: "Cloud VM",
  linux: "Linux/WSL",
  desktop: "Desktop",
  laptop: "Laptop",
  "mac-mini": "Mini PC",
  "mac-studio": "Workstation",
};

export function environmentMachineIcon(
  kind: EnvironmentMachineKind,
): FunctionComponent<AppIconProps> {
  return ICON_BY_KIND[kind];
}

export function EnvironmentMachineIcon({
  kind,
  ...props
}: AppIconProps & { readonly kind: EnvironmentMachineKind }) {
  const Icon = ICON_BY_KIND[kind];
  return <Icon {...props} />;
}
