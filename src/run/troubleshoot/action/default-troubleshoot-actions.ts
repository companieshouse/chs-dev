import checkForServicesInLiveUpdateConfigured from "./check-for-services-in-live-update-configured.js";
import { TroubleshootAction } from "./TroubleshootAction.js";

export const defaultTroubleshootActions: TroubleshootAction[] = [
    checkForServicesInLiveUpdateConfigured
];
