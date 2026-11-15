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
  console.log("DigitScope browser terminal compiled successfully.");
}

main().catch((error) => {
  console.error("DigitScope terminal build failed:", error);
  process.exit(1);
});
