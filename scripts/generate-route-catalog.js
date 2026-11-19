const { readdirSync, writeFileSync } = require("node:fs");
const { basename, dirname, extname, join } = require("node:path");

const routesDirectory = join(dirname(__filename), "..", "public", "rutas");
const catalogPath = join(routesDirectory, "catalog.json");
const routes = readdirSync(routesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && [".gpx", ".tcx"].includes(extname(entry.name).toLowerCase()))
  .map((entry) => ({
    file: entry.name,
    name: basename(entry.name, extname(entry.name))
      .replace(/[-_]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toLocaleUpperCase("es") + word.slice(1))
      .join(" "),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "es"));

writeFileSync(catalogPath, `${JSON.stringify({ routes }, null, 2)}\n`);
console.log(`Catálogo de rutas generado: ${routes.length} rutas.`);
