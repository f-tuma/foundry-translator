export type DependencyNodeState = "visiting" | "completed" | "failed";

export interface DependencyGraphFailure<TNode> {
  node: TNode;
  error: unknown;
}

export interface DependencyGraphResult<TNode> {
  completed: readonly TNode[];
  failures: readonly DependencyGraphFailure<TNode>[];
  states: ReadonlyMap<string, DependencyNodeState>;
}

export interface TraverseDependencyGraphOptions<TNode> {
  root: TNode;
  key(node: TNode): string;
  dependencies(node: TNode): Promise<readonly TNode[]> | readonly TNode[];
  process(node: TNode): Promise<void> | void;
  onCycle?: (from: TNode, to: TNode) => void;
}

export async function traverseDependencyGraph<TNode>(
  options: TraverseDependencyGraphOptions<TNode>,
): Promise<DependencyGraphResult<TNode>> {
  const states = new Map<string, DependencyNodeState>();
  const completed: TNode[] = [];
  const failures: DependencyGraphFailure<TNode>[] = [];
  const rootKey = options.key(options.root);

  const visit = async (node: TNode): Promise<void> => {
    const key = options.key(node);
    const state = states.get(key);
    if (state === "completed" || state === "failed") return;
    if (state === "visiting") return;
    states.set(key, "visiting");

    try {
      for (const dependency of await options.dependencies(node)) {
        const dependencyState = states.get(options.key(dependency));
        if (dependencyState === "visiting") {
          options.onCycle?.(node, dependency);
          continue;
        }
        await visit(dependency);
      }
      await options.process(node);
      states.set(key, "completed");
      completed.push(node);
    } catch (error) {
      states.set(key, "failed");
      failures.push({ node, error });
      if (key === rootKey) throw error;
    }
  };

  await visit(options.root);
  return { completed, failures, states };
}
