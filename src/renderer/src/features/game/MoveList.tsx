import { useMemo } from "react";
import { useGameStore } from "../../stores/game-store";

export function MoveList() {
  const moveTree = useGameStore((state) => state.moveTree);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const goToNode = useGameStore((state) => state.goToNode);
  const mainline = useMemo(() => {
    const result = [];
    let node = moveTree.find((item) => item.id === "root");
    while (node?.children[0]) {
      const next = moveTree.find((item) => item.id === node?.children[0]);
      if (!next) break;
      result.push(next);
      node = next;
    }
    return result;
  }, [moveTree]);

  if (!mainline.length) return <p className="empty">No moves yet.</p>;

  return (
    <div className="move-list">
      {mainline.map((node) => (
        <button
          key={node.id}
          className={node.id === currentNodeId ? "active" : ""}
          onClick={() => goToNode(node.id)}
        >
          {node.ply % 2 === 1 ? `${Math.floor(node.ply / 2) + 1}.` : ""}
          <span>{node.san}</span>
          {node.children.length > 1 ? <em>+{node.children.length - 1}</em> : null}
        </button>
      ))}
    </div>
  );
}
