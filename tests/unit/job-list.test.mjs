// The jobs list (6 November 2026, Section 6): sorts, filters, search, the "12 of 37" words, the remembered choice.
//   node --import ./tests/unit/register.mjs tests/unit/job-list.test.mjs        (npm run test:unit)
const L = await import("../../src/lib/job-list.ts");
const { applyJobList, readJobFilters, jobFilterQuery, hasListParams, filtersNarrow, shownWords, jobSearchHit, addRecentJob, readRecentJobs, DEFAULT_JOB_FILTERS } = L;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const now = new Date("2026-11-06T10:00:00Z"); // 14:00 in Dubai
const STAGES = ["gate_in", "inspection", "quote", "approval", "parts", "work", "qc", "wash", "ready"];
const job = (id, o) => ({ id, openedAt: "2026-11-01T08:00:00Z", promisedAt: null, stage: "work", status: "in_work", priority: "normal", department: "mechanical", advisorId: null, techIds: [], overdue: false, hoursInStage: 1, search: `J-${id}`, ...o });
const jobs = [
  job("1", { openedAt: "2026-10-20T08:00:00Z", stage: "parts", overdue: true, hoursInStage: 30, promisedAt: "2026-11-05T10:00:00Z", advisorId: "a1", search: "J-00901 DUBAI DD 23864 DD 23864 WAUZZZ4H AUDI A8" }),
  job("2", { openedAt: "2026-11-06T05:00:00Z", stage: "inspection", priority: "high", advisorId: "a2", techIds: ["t1"], search: "J-00990 DUBAI G 5 MERCEDES-BENZ S 580" }),
  job("3", { openedAt: "2026-11-03T05:00:00Z", stage: "ready", status: "ready", department: "bodyshop", advisorId: "a1", promisedAt: "2026-11-07T10:00:00Z", search: "J-00960 ABU DHABI 12 1234 BMW X5" }),
  job("4", { openedAt: "2026-11-04T05:00:00Z", stage: "work", overdue: true, hoursInStage: 5, department: "both", techIds: ["t1", "t2"], search: "J-00970 SHARJAH 3 777 PORSCHE 911" }),
];
const ids = (list) => list.map((j) => j.id).join(",");

check("default = newest opened first", ids(applyJobList(jobs, DEFAULT_JOB_FILTERS, now, STAGES)) === "2,4,3,1");
check("oldest first", ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, sort: "oldest" }, now, STAGES)) === "1,3,4,2");
check("most urgent: overdue first, then the longest in its stage", ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, sort: "urgent" }, now, STAGES)).startsWith("1,4"));
check("by stage, in workshop order", ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, sort: "stage" }, now, STAGES)) === "2,1,4,3");
check("by promised date, none at the end", ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, sort: "promised" }, now, STAGES)).startsWith("1,3"));

check("opened today (Dubai day)", ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, when: "today" }, now, STAGES)) === "2");
check("last 7 days", ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, when: "7d" }, now, STAGES)) === "2,4,3");
const lastWeekA1 = applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, when: "7d", advisor: "a1" }, now, STAGES);
check(`last 7 days + advisor: "${shownWords(lastWeekA1.length, jobs.length, true)}"`, ids(lastWeekA1) === "3" && shownWords(lastWeekA1.length, jobs.length, true) === "1 of 4");
check("stage, department, technician", ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, stage: "work" }, now, STAGES)) === "4" && ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, dept: "bodyshop" }, now, STAGES)) === "3" && ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, tech: "t1" }, now, STAGES)) === "2,4");
check("high priority, overdue, ready to collect", ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, high: true }, now, STAGES)) === "2" && ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, overdue: true }, now, STAGES)) === "4,1" && ids(applyJobList(jobs, { ...DEFAULT_JOB_FILTERS, ready: true }, now, STAGES)) === "3");

check("search a plate typed without spaces", jobSearchHit(jobs[0], "dd23864") && jobSearchHit(jobs[0], "DD 23864"));
check("search a job number, a VIN start, make and model", jobSearchHit(jobs[0], "j-00901") && jobSearchHit(jobs[0], "wauzzz") && jobSearchHit(jobs[0], "audi a8") && !jobSearchHit(jobs[0], "bmw"));

check("the address round-trips", JSON.stringify(readJobFilters(Object.fromEntries(new URLSearchParams(jobFilterQuery({ ...DEFAULT_JOB_FILTERS, sort: "urgent", when: "7d", advisor: "11111111-1111-4111-8111-111111111111", high: true, q: "audi" }))))) === JSON.stringify({ ...DEFAULT_JOB_FILTERS, sort: "urgent", when: "7d", advisor: "11111111-1111-4111-8111-111111111111", high: true, q: "audi" }));
check("broken values fall back to the defaults", JSON.stringify(readJobFilters({ sort: "x", when: "y", advisor: "nope", stage: "<b>" })) === JSON.stringify(DEFAULT_JOB_FILTERS));
check("the default leaves the address empty", jobFilterQuery(DEFAULT_JOB_FILTERS) === "" && !hasListParams({ show: "closed" }) && hasListParams({ sort: "oldest" }));
check(`"37 jobs" with no filter, "12 of 37" with one`, shownWords(37, 37, false) === "37 jobs" && shownWords(12, 37, true) === "12 of 37" && !filtersNarrow({ ...DEFAULT_JOB_FILTERS, sort: "oldest" }));

let recent = [];
for (const n of ["1", "2", "3", "4", "5", "6", "2"]) recent = addRecentJob(recent, { id: n, n: `J-${n}`, p: "P", t: "T" });
check("recently viewed: five, newest first, no repeats", recent.map((j) => j.id).join(",") === "2,6,5,4,3");
check("broken storage reads as none", readRecentJobs("{oops").length === 0 && readRecentJobs(null).length === 0);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
if (failed) process.exit(1);
