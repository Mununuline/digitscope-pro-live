const esbuild = require("esbuild");
const path = require("path");

async function main() {
  const common = {
    bundle: false,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    legalComments: "none"
  };
  await esbuild.build({
    ...common,
    entryPoints: [path.join(__dirname, "public", "terminal.jsx")],
    outfile: path.join(__dirname, "public", "terminal.js")
  });
  await esbuild.build({
    ...common,
    entryPoints: [path.join(__dirname, "public", "trade-desk.jsx")],
    outfile: path.join(__dirname, "public", "trade-desk.js")
  });
  console.log("DigitScope backoffice and trading front desk compiled successfully.");
}

main().catch((error) => {
  console.error("DigitScope browser build failed:", error);
  process.exit(1);
});
