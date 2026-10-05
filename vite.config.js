import { defineConfig } from "vite";

let phoneState = { command: "stop", video: "/medicine-videos/paracetamol.mp4" };

function phoneControlPlugin() {
    return {
        name: "phone-control",
        configureServer(server) {

            server.middlewares.use("/api/dispense", async (req, res) => {
                if (req.method !== "GET" && req.method !== "POST") {
                    res.statusCode = 405;
                    res.end();
                    return;
                }
                try {
                    const esp = await fetch("http://10.127.198.165/dispense", { method: "GET" });
                    const body = await esp.text();
                    res.statusCode = esp.status;
                    res.setHeader("Content-Type", "text/plain");
                    res.setHeader("Cache-Control", "no-store");
                    res.end(body);
                } catch (error) {
                    res.statusCode = 502;
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify({ ok: false, error: String(error) }));
                }
            });

            server.middlewares.use("/api/phone/start", (req, res) => {
                if (req.method === "POST") {
                    const url = new URL(req.url || "/", "http://localhost");
                    const video = url.searchParams.get("video");
                    phoneState = {
                        command: "start",
                        video: video && video.startsWith("/medicine-videos/")
                            ? video
                            : "/medicine-videos/paracetamol.mp4"
                    };
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "application/json");
                    res.setHeader("Cache-Control", "no-store");
                    res.end(JSON.stringify({ ok: true, ...phoneState }));
                    return;
                }
                res.statusCode = 405;
                res.end();
            });

            server.middlewares.use("/api/phone/stop", (req, res) => {
                if (req.method === "POST") {
                    phoneState = { ...phoneState, command: "stop" };
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "application/json");
                    res.setHeader("Cache-Control", "no-store");
                    res.end(JSON.stringify({ ok: true, ...phoneState }));
                    return;
                }
                res.statusCode = 405;
                res.end();
            });

            server.middlewares.use("/api/phone/dispense-audio", (req, res) => {
                if (req.method === "POST") {
                    phoneState = { ...phoneState, command: "dispense-audio" };
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "application/json");
                    res.setHeader("Cache-Control", "no-store");
                    res.end(JSON.stringify({ ok: true, ...phoneState }));
                    return;
                }
                res.statusCode = 405;
                res.end();
            });

            server.middlewares.use("/api/phone/complete", (req, res) => {
                if (req.method === "POST") {
                    phoneState = { ...phoneState, command: "completed" };
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "application/json");
                    res.setHeader("Cache-Control", "no-store");
                    res.end(JSON.stringify({ ok: true, ...phoneState }));
                    return;
                }
                res.statusCode = 405;
                res.end();
            });

            server.middlewares.use("/api/phone/state", (req, res) => {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
                res.end(JSON.stringify(phoneState));
            });
        }
    };
}

export default defineConfig({
    plugins: [phoneControlPlugin()],
    server: {
        host: "0.0.0.0"
    }
});
