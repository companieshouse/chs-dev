export interface DependencyNode{
    name: string,
    dependencies: DependencyNode[];
}

export default DependencyNode;
