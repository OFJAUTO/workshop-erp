// Gate-in videos much clearer (9 November 2026, Section 7): THE rules in src/lib/video-quality.ts.
//   node --import ./tests/unit/register.mjs tests/unit/video-quality.test.mjs        (npm run test:unit)
const { qualityProblem, qualityWords, recorderType, storageCostWords, VIDEO_TARGET, MIN_SHORT_SIDE } = await import("../../src/lib/video-quality.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("records at 1920 x 1080, 30 fps", VIDEO_TARGET.width === 1920 && VIDEO_TARGET.height === 1080 && VIDEO_TARGET.fps === 30);
check("1080p is fine", qualityProblem(1920, 1080, "camera") === null);
check("720p is fine (portrait too)", qualityProblem(1280, 720, "camera") === null && qualityProblem(720, 1280, "file") === null);
check("the old 480 x 360 is refused, in words", (qualityProblem(480, 360, "file") ?? "").startsWith("This video is only 480 × 360"));
check("a low camera is refused, in words", (qualityProblem(640, 360, "camera") ?? "").startsWith("This camera only gives 640 × 360"));
check("unknown size is not refused (the server keeps it)", qualityProblem(null, null, "file") === null);
check("the 720 line", MIN_SHORT_SIDE === 720);
check("the quality words", qualityWords(1920, 1080, 29.97) === "1920 × 1080 · 30 fps");
check("MP4 first where the browser makes it", recorderType((t) => t.startsWith("video/mp4")).contentType === "video/mp4");
check("WebM otherwise", recorderType((t) => t.startsWith("video/webm")).ext === "webm");
check("the storage line", storageCostWords(1073741824 * 10) === "10.00 GB · about USD 0.21 a month");

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
