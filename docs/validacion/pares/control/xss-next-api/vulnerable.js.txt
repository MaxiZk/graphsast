export default function handler(req, res) {
  const { mensaje } = req.query;
  res.setHeader("Content-Type", "text/html");
  res.end(`<html><body><h1>${mensaje}</h1></body></html>`);
}
