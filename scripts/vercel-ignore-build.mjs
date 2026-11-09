// VERCEL'S «IGNORED BUILD STEP» FOR THIS REPO (vercel.json → ignoreCommand).
// Exit 1 = build. Exit 0 = cancel this deployment. Vercel's convention, not ours.
//
// WHY IT EXISTS. Two Vercel projects are connected to this repository and both build every
// push: `sevenz-site-dashboard`, the real one (it holds the environment variables and serves
// app.sevenz.site), and `sevenz-dashboard`, an older one with no variables. Found on
// 2026-11-09 reading the GitHub deployments of the v0.5.1 release commit; the owner confirmed
// which one is real that day and asked for the code to stop the other: «podrías ajustar el
// código para que solo use el correcto? no elimines el otro hasta confirmar que el ajuste no
// daña el app». Each push was built twice, on a Hobby plan whose build minutes production
// shares. The other project's crons were harmless: with no CRON_SECRET every route answers
// 401.
//
// THE RULE IS «BUILD UNLESS IT IS POSITIVELY THE OTHER PROJECT». The failure that matters is
// cancelling the real project by mistake: production would stop deploying, and a cancelled
// deployment does not look like an error. So the real project's id always builds, and a
// deployment is cancelled only when its own Vercel URL names the other project. Anything
// unknown (a variable missing, a third project, a renamed one) builds, which is how it was
// before this file.
//
// WHAT THIS OVERRIDES. `ignoreCommand` in vercel.json replaces the «Ignored Build Step» set in
// the Vercel dashboard of BOTH projects. If the real project had one there, it no longer runs.
//
// The definitive fix is not in code: disconnect the Git repository in the other project's
// settings, or delete it. This file can go once that is done.

const REAL_PROJECT_ID = "prj_SVE3l8WQf4qUlFdW9P6KzRptNYY5"; // sevenz-site-dashboard, .vercel/project.json
const OTHER_PROJECT_NAME = "sevenz-dashboard";

export function decide(env) {
  if (env.VERCEL_PROJECT_ID === REAL_PROJECT_ID) return { build: true, reason: "proyecto correcto por id" };
  // A deployment URL is «<project>-<hash>-<team>.vercel.app» and a branch URL
  // «<project>-git-<branch>-<team>.vercel.app». The real project's name starts with
  // «sevenz-site-», so the prefix below can never match it.
  const urls = [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter(Boolean);
  if (urls.some((u) => u.startsWith(`${OTHER_PROJECT_NAME}-`))) {
    return { build: false, reason: `proyecto ${OTHER_PROJECT_NAME}, sin variables de entorno` };
  }
  return { build: true, reason: "no se reconoce como el otro proyecto" };
}

if (process.argv[1]?.endsWith("vercel-ignore-build.mjs")) {
  const { build, reason } = decide(process.env);
  console.log(
    `[ignored build step] ${build ? "SE CONSTRUYE" : "SE CANCELA"}: ${reason}. ` +
      `project_id=${process.env.VERCEL_PROJECT_ID ?? "(sin)"} url=${process.env.VERCEL_URL ?? "(sin)"}`,
  );
  process.exit(build ? 1 : 0);
}
