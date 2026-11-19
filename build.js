const esbuild = require("esbuild");
const path = require("path");

async function main() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "public", "terminal.jsx")],
    outfile: path.join(__dirname, "public", "terminal.js"),
    bundle: false,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    legalComments: "none"
  });
  await esbuild.build({\n    entryPoints: [path.join(__dirname, "public", "trade-desk.jsx")],\n    outfile: path.join(__dirname, "public", "trade-desk.js"),\n    bundle: false, format: "iife", platform: "browser", target: ["es2020"],\n    jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment", legalComments: "none"\n  });\n  console.log("DigitScope backoffice and trading front desk compiled successfully.");
}

main().catch((error) => {
  console.error("DigitScope terminal build failed:", error);
  process.exit(1);
});
