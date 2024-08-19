#!/usr/bin/env node

const core = require("@actions/core");
const { context, getOctokit } = require("@actions/github");

async function run() {
    // Basic argument handling
    const trigger = core.getInput("trigger", { required: true });
    let mention = core.getInput("mention", { required: false });

    if (mention !== '' && !mention.startsWith("@")) {
        mention = "@" + mention;
    }

    const reaction = core.getInput("reaction");
    const { GITHUB_TOKEN } = process.env;
    if (reaction && !GITHUB_TOKEN) {
        core.setFailed('If "reaction" is supplied, GITHUB_TOKEN is required');
        return;
    }

    // Get body of the comment
    const body =
        (context.eventName === "issue_comment"
            ? // For comments on pull requests
              context.payload.comment.body
            : // For the initial pull request description
              context.payload.pull_request.body) || "";
    core.setOutput("comment_body", body);

    // In case the comment is not pull-request based, abort.
    if (
        context.eventName === "issue_comment" &&
        !context.payload.issue.pull_request
    ) {
        // not a pull-request comment, aborting
        core.setOutput("triggered", "false");
        return;
    }

    // Check if the trigger text is in the body
    const { owner, repo } = context.repo;
    const client = getOctokit(GITHUB_TOKEN);

    const prNumber = context.payload.issue.number;
    const {data} = await client.rest.pulls.get({repo, owner, issue_number: prNumber});
    core.info(`Fetch pull request ${prNumber} for ${owner}/${repo}.`);
    
    const open = core.getInput('open');
    core.info(`Data is ${JSON.stringify(data)}`);
    core.info(`PR state is ${data.state}`);
    if (open === 'true' && data.state !== 'open') {
        core.info('PR was closed... Skip.');
        core.setOutput('triggered', 'false');
        return;
    }

    const prefixOnly = core.getInput("prefix_only") === "true";
    const allowArguments = core.getInput("allow_arguments") === "true";

    // If no mention is needed then we default to true in order to trigger next steps.
    let hasMention = mention !== '' ? body.toLowerCase().includes(mention.toLowerCase()) : true;
    let hasTrigger = body.includes(trigger);

    if (allowArguments) {
        let regexRawTrigger = trigger.replace(/\s\*{2}/g, " [^\\s]+");

        if (prefixOnly) {
            regexRawTrigger = `^${regexRawTrigger}$`;
        } else {
            regexRawTrigger = `${regexRawTrigger}$`;
        }

        const regexTrigger = new RegExp(regexRawTrigger);

        hasTrigger = regexTrigger.test(body);
    }

    if ((prefixOnly && !hasTrigger) || !hasTrigger || !hasMention) {
        core.setOutput("triggered", "false");
        return;
    }

    // At his point the trigger check has passed.
    core.setOutput("triggered", "true");

    // Parse arguments and set them as output
    if (allowArguments && trigger.includes("**")) {
        const args = [];

        const triggerSplit = trigger.split(" ");
        const bodySplit = body.split(" ");

        triggerSplit.forEach((part, i) => {
            if (part !== "**") return;

            args.push(bodySplit[i]);
        });

        core.setOutput("arguments", JSON.stringify(args));
    }

    // Create reaction in the comment if needed
    if (!reaction) {
        return;
    }

    if (context.eventName === "issue_comment") {
        await client.rest.reactions.createForIssueComment({
            owner,
            repo,
            comment_id: context.payload.comment.id,
            content: reaction,
        });
    } else {
        await client.rest.reactions.createForIssue({
            owner,
            repo,
            issue_number: context.payload.pull_request.number,
            content: reaction,
        });
    }
}

run().catch((err) => {
    console.error(err);
    core.setFailed("Unexpected error");
});
