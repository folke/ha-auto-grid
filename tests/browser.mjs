import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"

const root = new URL("../", import.meta.url)
const page = process.argv[2] === "editor" ? "editor" : "browser"
const server = createServer(async (request, response) => {
  let path
  if (request.url === `/tests/${page}.html`) path = `tests/${page}.html`
  else if (request.url === "/dist/auto-grid.js") path = "dist/auto-grid.js"
  if (!path) {
    response.writeHead(404).end()
    return
  }
  try {
    response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/html")
    response.end(await readFile(new URL(path, root)))
  } catch {
    response.writeHead(500).end()
  }
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const port = server.address().port
try {
  const output = await new Promise((resolve, reject) => {
    const browser = spawn(process.env.CHROME_BIN ?? "chromium", [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--dump-dom",
      "--virtual-time-budget=5000",
      `http://127.0.0.1:${port}/tests/${page}.html`,
    ])
    let stdout = "",
      stderr = ""
    const timer = setTimeout(() => {
      browser.kill("SIGKILL")
      reject(new Error("Browser test timed out"))
    }, 30_000)
    browser.stdout.on("data", (data) => {
      stdout += data
    })
    browser.stderr.on("data", (data) => {
      stderr += data
    })
    browser.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    browser.on("exit", (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(stderr))
      else resolve(stdout)
    })
  })
  assert.match(output, /<body data-status="passed">/, output)
  console.log(`${page}: ${output.match(/Passed \d+ browser assertions/)?.[0]}`)
} finally {
  server.close()
}
