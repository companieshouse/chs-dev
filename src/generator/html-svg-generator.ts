export abstract class HTLMSVGGenerator {

    // eslint-disable-next-line no-useless-constructor
    constructor () {}

    generateHTMLContent (serviceName: string, serviceDetailsMap): string {
        return `
    <!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8" />
    <title>${serviceName} Dependency Diagram</title>
    <style>
      #tooltip {
        position: absolute;
        background: #eee;
        border: 1px solid #333;
        padding: 8px;
        display: none;
        pointer-events: none;
        max-width: 320px;
        white-space: pre-wrap;
        font-family: monospace;
        box-shadow: 2px 2px 6px rgba(0,0,0,0.3);
        z-index: 10;
      }
    </style>
    </head>
    <body>
      <div id="graph-container" style="position: relative;"></div>
      <div id="tooltip"></div>

      <script>
        const serviceDetails = ${JSON.stringify(serviceDetailsMap)};
        async function loadSVG() {
          const response = await fetch('${serviceName}-dependency_diagram.svg');
          const svgText = await response.text();
          document.getElementById('graph-container').innerHTML = svgText;
          const tooltip = document.getElementById('tooltip');

          Object.entries(serviceDetails).forEach(([name, detail]) => {
            const id = 'node-' + name.replace(/\\s+/g, '_');
            const node = document.getElementById(id);
            if (!node) return;

            node.addEventListener('mouseenter', (e) => {
              tooltip.style.display = 'block';
              tooltip.textContent = detail;
            });
            node.addEventListener('mousemove', (e) => {
              tooltip.style.top = (e.pageY + 10) + 'px';
              tooltip.style.left = (e.pageX + 10) + 'px';
            });
            node.addEventListener('mouseleave', () => {
              tooltip.style.display = 'none';
            });
            node.addEventListener('click', () => {
              alert(detail);
            });
          });
        }
        loadSVG();
      </script>
    </body>
    </html>`;
    }

}
