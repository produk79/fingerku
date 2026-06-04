#!/usr/bin/env node
const args = process.argv.slice(2);
const cmd = args[0];
if (cmd === "check") {
  console.log(JSON.stringify({ ok:false, message:"Placeholder only. Replace with official .NET/C++ SDK bridge.", supportsRemoteEnroll:false }));
  process.exit(1);
}
if (cmd === "enroll") {
  console.log(JSON.stringify({ ok:false, error:"Placeholder only. Replace with official .NET/C++ SDK bridge." }));
  process.exit(1);
}
console.log(JSON.stringify({ ok:false, error:"Unknown command" }));
process.exit(1);
