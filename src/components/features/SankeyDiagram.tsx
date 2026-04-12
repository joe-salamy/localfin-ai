import type { SankeyData } from '@/types';
import { ResponsiveSankey } from '@nivo/sankey';

interface SankeyDiagramProps {
  data: SankeyData;
}

export function SankeyDiagram({ data }: SankeyDiagramProps) {
  if (!data || data.nodes.length === 0 || data.links.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No flow data available.</p>;
  }

  return (
    <div style={{ height: 400 }}>
      <ResponsiveSankey
        data={data}
        margin={{ top: 20, right: 120, bottom: 20, left: 120 }}
        align="justify"
        colors={(node) => (node as { nodeColor?: string }).nodeColor ?? '#888'}
        nodeOpacity={1}
        nodeHoverOthersOpacity={0.35}
        nodeThickness={14}
        nodeSpacing={16}
        nodeBorderWidth={0}
        nodeBorderRadius={2}
        linkOpacity={0.3}
        linkHoverOthersOpacity={0.1}
        linkContract={1}
        enableLinkGradient
        labelPosition="outside"
        labelOrientation="horizontal"
        labelPadding={8}
        labelTextColor="#ffffff"
        theme={{
          tooltip: {
            container: {
              background: '#1f1f1f',
              color: '#ddd',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid #333',
            },
          },
          labels: {
            text: {
              fill: '#ffffff',
              fontSize: 11,
            },
          },
        }}
      />
    </div>
  );
}
