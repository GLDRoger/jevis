/**
 * The axes: a profile Jev scores on every event of a kind, the spider chart.
 * Entries gate on them in `when` instead of each repeating the same question,
 * and every profile is logged, so it shows what kinds of work a session holds.
 *
 * Each axis is a noul (probability of yes). Questions name the state field
 * they read and spell out their boundary cases: Jev answers literally.
 */
const noul = (instructions, yes, no) => ({ type: "noul", instructions, criteria: { true: yes, false: no } });

export const AXES = {
  prompt: {
    wants_change: noul(
      "Does `request` ask the agent to make, change, fix, or run something, rather than only answer, explain, review, or discuss?",
      "The agent is asked to produce or change something: files, code, a page, a document, a command's effect",
      "A question, opinion, review, plan, status check, or discussion, with nothing to change yet",
    ),
    open_ended: noul(
      "Does `request` leave most decisions about the result to the agent?",
      "Short or loose: the look, structure, approach, or content is mostly the agent's call",
      "Detailed: the request specifies most of the result, or it is a narrow fix with one right answer",
    ),
    visual: noul(
      "Is the result of `request` something people will look at: a user interface, a web page, visual design, an image, a video, an animation, or slides?",
      "The work changes or creates something visual",
      "Backend, data, configuration, scripts, prose, or questions with no visual result",
    ),
    code: noul("Does `request` involve writing or changing software code?", "Code is written or changed", "No code changes: prose, files, questions, operations"),
    new_build: noul(
      "Does `request` ask for something new to be made from scratch, rather than a change to something that exists?",
      "A new site, app, feature built from nothing, piece, or document",
      "A change, fix, or addition to existing work",
    ),
    risky: noul(
      "Could doing `request` affect production systems, real users' data, money, credentials, or anything hard to undo?",
      "Deploys, migrations, deletions, payments, secrets, messages to real people, force pushes",
      "Local work that is easy to undo",
    ),
    correction: noul(
      "Is `request` correcting, complaining about, or rejecting the agent's earlier work (see `previous_request`)?",
      "The user says the earlier result was wrong, missing, generic, broken, or not what they asked",
      "A new request, a follow-up that builds on accepted work, or thanks",
    ),
    delegation: noul(
      "Does `request` ask the agent to use subagents, other agents, or another model?",
      "Explicitly asks to delegate, fan out, or get another agent's view",
      "No mention of other agents",
    ),
    current_facts: noul(
      "Does answering `request` correctly depend on facts that may have changed recently: current versions, prices, APIs, news, or live systems?",
      "Needs current or external information",
      "Stable knowledge, or only the local project",
    ),
    writing: noul(
      "Is prose the main product of `request`: documentation, copy, an essay, an email, a prompt, or instructions?",
      "The deliverable is mostly written text",
      "Code, design, data, or a question",
    ),
  },
  tool: {
    destructive: noul(
      "Could running `input` delete or overwrite data, files, or history that cannot easily be recovered?",
      "rm, overwriting files, resets, dropping tables, force pushes, deleting branches or resources",
      "Reads, searches, builds, tests, or ordinary edits under version control",
    ),
    outward: noul(
      "Does `input` send something outside this machine or publish it: a push, deploy, release, message, email, upload, or public post?",
      "Something leaves the machine or becomes visible to others",
      "Local only, or only reads from the network",
    ),
  },
  stop: {
    work_requested: noul(
      "Does `request` ask the agent to make, change, fix, build, or run something, rather than only answer a question, explain, discuss, or give an opinion?",
      "The user asked for work to be done",
      "A question, discussion, idea, opinion, review of a proposal, or status check",
    ),
    visual: noul(
      "Is the result of `request` something people look at: a user interface, a web page, visual design, an animation, a film, or slides?",
      "The requested work changes or creates something visual",
      "Backend, data, configuration, scripts, prose, or questions with no visual result",
    ),
    film: noul(
      "Does `request` ask for a film, video, trailer, or animated piece meant to be watched as it plays?",
      "A piece that plays over time: a film, a motion piece, an animated story",
      "A page, app, or interface, even one with some animation in it",
    ),
    claims_done: noul(
      "Does `final_message` say the requested work is complete?",
      "Reports the task done, fixed, shipped, or working",
      "Asks a question, reports a blocker, or gives a partial result as partial",
    ),
    claims_verified: noul(
      "Does `final_message` say something was tested, verified, checked, or seen working?",
      "Claims tests passed, a build succeeded, or the result was checked in a browser or by running it",
      "Makes no claim of verification",
    ),
  },
};

export const axisKey = (id) => `axis.${id}`;
