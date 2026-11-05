export interface AwsProfileInfo {
    name: string;
    region?: string;
    account?: string;
}
export interface EcrRegistry {
    host: string;
    account: string;
    region: string;
    /** Profiles whose account and region match the registry. */
    profiles: string[];
}
export interface DiscoveredProfile extends AwsProfileInfo {
    /** Recommended because a project registry needs it. */
    required: boolean;
    registries: string[];
}
export interface ProfileDiscovery {
    profiles: DiscoveredProfile[];
    registries: EcrRegistry[];
    /** Registries used by the project that no local profile can log in to. */
    unmatched: string[];
    /** One profile per matched registry, preferring the primary profile. */
    recommended: string[];
    warnings: string[];
}
