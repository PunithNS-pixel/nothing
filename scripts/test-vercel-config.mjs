import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {pathToFileURL} from "node:url";
const target=pathToFileURL(path.resolve("nothing-coffee/vercel.mjs")).href;
process.env.MARKETPLACE_BACKEND_ORIGIN="https://api.example.org";
delete process.env.VERCEL_ENV;
const {config}=await import(target);
assert.equal(config.framework,null);
assert.deepEqual(config.rewrites,[
  {source:"/api/:path*",destination:"https://api.example.org/api/:path*"},
  {source:"/images/:path*",destination:"https://api.example.org/images/:path*"}
]);
assert.ok(config.headers.some(x=>x.source==="/api/:path*"&&
    x.headers.some(y=>y.key==="Cache-Control"&&y.value==="no-store")));
function run(origin){
  return spawnSync(process.execPath,[
    "--input-type=module","-e",`import(${JSON.stringify(target)})`
  ],{encoding:"utf8",env:{...process.env,VERCEL_ENV:"production",
    MARKETPLACE_BACKEND_ORIGIN:origin}});
}
assert.equal(run("https://api.example.org").status,0);
for(const invalid of ["","http://localhost:8090","http://api.example.org",
 "https://api.example.org/api","https://u:p@api.example.org",
 "https://api.example.org?key=x"]) {
  const p=run(invalid);
  assert.notEqual(p.status,0,"Rejected invalid backend URL "+invalid);
}
console.log("Vercel routing config tests passed");
