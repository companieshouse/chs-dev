export enum DependencyObjectType {
    SERVICE = "service",
    SYSTEM = "system"
}

export interface DependencyNode{
    name: string,
    dependencies: DependencyNode[];
}
