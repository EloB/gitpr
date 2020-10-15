#!/usr/bin/env node

const child_process = require("child_process");
const util = require("util");

const inquirer = require("inquirer");
const chalk = require("chalk");
const parseGitStatus = require("parse-git-status");
const getBranch = require("git-branch");
const getRemoteOriginUrl = require("git-remote-origin-url");
const open = require("open");

inquirer.registerPrompt("search-checkbox", require("inquirer-search-checkbox"));

const cpExec = util.promisify(child_process.exec);
const getStatus = async () => {
  const { stdout } = await cpExec("git status --porcelain -z");
  return parseGitStatus(stdout);
};

const getDefaultBranch = async () => {
  const { stdout } = await cpExec("git remote show origin");
  const row = stdout
    .split("\n")
    .map((row) => row.trim())
    .find((text) => text.startsWith("HEAD branch:"));
  return (row || "").replace("HEAD branch: ", "");
};

const exec = async (command, ...args) => {
  console.log(`${chalk.cyan("$")} ${command}`);
  const result = await cpExec(command, ...args);
  if (result.stdout) console.log(chalk.grey(result.stdout));
  if (result.stderr) console.error(chalk.red(result.stderr));
  console.log("");
  return result;
};

const isRequired = (message = false) => (value) => value.length > 0 || message;

const mapper = {
  "?": chalk.red,
  M: chalk.green,
};

const LAST_COMMIT = "Last commit";
const SELECT_FILES = "Select files";

(async () => {
  try {
    const files = await getStatus();

    if (files.some(({ x }) => ![" ", "?"].includes(x)))
      throw new Error("You are not allowed to have added files");

    const origin = await getRemoteOriginUrl();
    const defaultBranch = await getDefaultBranch();
    const branch = await getBranch();

    const path = origin.slice(15, -4);

    const { method } = await inquirer.prompt([
      {
        type: "list",
        name: "method",
        message: "Method:",
        choices: [LAST_COMMIT, SELECT_FILES],
      },
    ]);

    const answers = await inquirer.prompt(
      [
        method === SELECT_FILES && {
          type: "search-checkbox",
          name: "files",
          message: "Files to commit:",
          choices: files.map(({ y, to }) => ({
            name: `${(mapper[y] || chalk.cyan)(y)} ${to}`,
            value: to,
          })),
          validate: isRequired("You need to select at least one file."),
        },
        {
          type: "list",
          name: "type",
          message: "Type:",
          choices: ["feature", "fixes"],
        },
        {
          type: "input",
          name: "branch",
          message: "Branch name:",
          transformer: (value, { type }) => `${chalk.grey(`${type}/`)}${value}`,
          validate: (value) => {
            if (!/^[a-z-]+$/.test(value))
              return "You need to specify small characters.";
            return isRequired("You need to specify a branch name.")(value);
          },
        },
        method === SELECT_FILES && {
          type: "input",
          name: "message",
          message: "Commit message:",
          validate: isRequired("You need to specify a commit message."),
        },
      ].filter(Boolean)
    );

    console.log("");

    if (method === SELECT_FILES) {
      await exec(
        `git add ${answers.files.map((file) => JSON.stringify(file)).join(" ")}`
      );
      await exec(`git commit -m ${JSON.stringify(answers.message)}`);
    }
    const combinedBranch = JSON.stringify(`${answers.type}/${answers.branch}`);
    const { stdout: commit } = await exec(`git rev-parse HEAD`);
    await exec("git reset --hard HEAD~1");
    await exec("git fetch");
    await exec(`git checkout ${defaultBranch}`);
    await exec("git pull");
    await exec(`git checkout -b ${combinedBranch}`);
    await exec(`git cherry-pick ${commit}`);
    await exec(`git push --set-upstream origin ${combinedBranch}`);
    await exec(`git checkout ${branch}`);
    await open(`https://github.com/${path}/compare/${combinedBranch}?expand=1`);
  } catch (error) {
    console.error(chalk.red(error.message || error));
    process.exit(1);
  }
})();
