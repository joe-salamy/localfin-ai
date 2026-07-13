import type { SankeyData } from "@shared/contracts"
import { ResponsiveSankey } from "@nivo/sankey";
import { useEffect, useMemo, useRef, useState } from "react";

interface SankeyDiagramProps {
  data: SankeyData;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function getNodeLabel(node: { id: string; displayName?: string }) {
  return node.displayName ?? node.id;
}

function truncateLabel(label: string, maxLength: number) {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, Math.max(1, maxLength - 1))}...`;
}

function useElementWidth<TElement extends HTMLElement>() {
  const ref = useRef<TElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateWidth = () => setWidth(element.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

export function SankeyDiagram({ data }: SankeyDiagramProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();

  const chartConfig = useMemo(() => {
    const nodeCount = data?.nodes.length ?? 0;
    const effectiveWidth = width || 900;
    const compact = effectiveWidth < 720;
    const veryCompact = effectiveWidth < 520;

    return {
      height: Math.min(
        920,
        Math.max(compact ? 500 : 460, nodeCount * (compact ? 26 : 24)),
      ),
      margin: {
        top: 24,
        right: veryCompact ? 96 : compact ? 140 : 220,
        bottom: 24,
        left: veryCompact ? 96 : compact ? 140 : 180,
      },
      labelMaxLength: veryCompact ? 10 : compact ? 16 : 24,
      nodeSpacing: compact ? 10 : 12,
      nodeThickness: compact ? 10 : 12,
    };
  }, [data?.nodes.length, width]);

  if (!data || data.nodes.length === 0 || data.links.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No flow data available.
      </p>
    );
  }

  return (
    <div
      ref={ref}
      className="w-full min-w-0"
      style={{ height: chartConfig.height }}
    >
      <ResponsiveSankey
        data={data}
        margin={chartConfig.margin}
        align="justify"
        sort="descending"
        valueFormat={(value) => currencyFormatter.format(value)}
        label={(node) =>
          truncateLabel(getNodeLabel(node), chartConfig.labelMaxLength)
        }
        colors={(node) => (node as { nodeColor?: string }).nodeColor ?? "#888"}
        nodeOpacity={1}
        nodeHoverOpacity={1}
        nodeHoverOthersOpacity={0.25}
        nodeThickness={chartConfig.nodeThickness}
        nodeSpacing={chartConfig.nodeSpacing}
        nodeBorderWidth={0}
        nodeBorderRadius={2}
        linkOpacity={0.55}
        linkHoverOpacity={0.85}
        linkHoverOthersOpacity={0.16}
        linkContract={0}
        linkBlendMode="normal"
        enableLinkGradient
        labelPosition="outside"
        labelOrientation="horizontal"
        labelPadding={10}
        labelTextColor="#ffffff"
        nodeTooltip={({ node }) => (
          <div className="space-y-1">
            <div className="font-medium text-foreground">
              {getNodeLabel(node)}
            </div>
            <div className="font-mono text-xs tabular-nums text-muted-foreground">
              {node.formattedValue}
            </div>
          </div>
        )}
        linkTooltip={({ link }) => (
          <div className="space-y-1">
            <div className="font-medium text-foreground">
              {getNodeLabel(link.source)} {"->"} {getNodeLabel(link.target)}
            </div>
            <div className="font-mono text-xs tabular-nums text-muted-foreground">
              {link.formattedValue}
            </div>
          </div>
        )}
        ariaLabel="Money flow Sankey diagram"
        theme={{
          tooltip: {
            container: {
              background: "#1f1f1f",
              color: "#ddd",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #333",
            },
          },
          labels: {
            text: {
              fill: "#ffffff",
              fontSize: 11,
            },
          },
        }}
      />
    </div>
  );
}
