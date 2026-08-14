import { analyzeGraph, analyzeTaint } from "../index.js";

const expressRoute = `const express = require('express');
const app = express();
app.post('/finances', async (req, res) => {
  const finance = new Finance(req.body);
  await finance.save();
  res.json(finance);
});`;

const fnStyle = `function postFinances(req, res) {
  const data = req.body;
  db.query(data);
}`;

for (const [name, code] of [
  ["express-arrow", expressRoute],
  ["function-style", fnStyle],
] as const) {
  const g = analyzeGraph(code, "probe.js");
  const params = g.nodes.filter((n) => n.kind === "Parameter").length;
  const findings = analyzeTaint(g).length;
  console.log(name, { nodes: g.nodes.length, params, findings });
}
