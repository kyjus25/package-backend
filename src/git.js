/**
 * @module git
 * @desc Assists in interactions between the backend and GitHub.
 */

const superagent = require("superagent");
const { GH_USERAGENT } = require("./config.js").getConfig();
const logger = require("./logger.js");
let GH_API_URL = "https://api.github.com";
let GH_WEB_URL = "https://github.com";

/**
 * @function setGHWebURL
 * @desc Allows this module to be more testable. Sets a single place to modify
 * the URL to which all Web based outgoing requests are destined.
 * @param {string} val - The new URL to set this to.
 */
function setGHWebURL(val) {
  GH_WEB_URL = val;
}

/**
 * @function setGHAPIURL
 * @desc Allows this module to be more testable. Sets a single place to modify
 * the URL to which all API based outgoing requests are destined.
 * @param {string} val - The new URL to set this to.
 */
function setGHAPIURL(val) {
  GH_API_URL = val;
}

/**
 * @async
 * @function ownership
 * @desc Allows the ability to check if a user has permissions to write to a repo.
 * <b>MUST</b> Be provided `owner/repo` to successfully function, and expects the
 * full `user` object. Returns `ok: true` where content is the repo data from GitHub
 * on success, returns `short: "No Repo Access"` if they do not have permisison
 * to affect said repo or `short: "Server Error"` if any other error has occured.
 * @param {object} user - The Full User object, including `name`, `github_token`.
 * @param {string} repo - The `owner/repo` of the repo changes are intended to affect.
 * @param {boolean} [dev_override=false] - A Dangerous optional parameter, that is
 * intended to be used during tests that overrides the default safe static returns, and
 * lets the function run as intended in a development environment.
 */
async function ownership(user, repo, dev_override = false) {
  // user here is a full fledged user object. And repo is a text representation of the repository.
  // Since git auth is not setup, this will return positive.
  if (process.env.PULSAR_STATUS == "dev" && !dev_override) {
    console.log(
      `git.js.Ownership() Is returning Dev Only Permissions for ${logger.sanitizeLogs(
        user.username
      )}`
    );

    switch (user.username) {
      case "admin_user":
        // This is a special case that will allow unfettered
        // access to all server resources, and global resources.
        // It must be ensured that the production instance doesn't run
        // in dev mode, or risk Unauthorized access.
        return { ok: true, content: "Development Admin User" };

      case "no_perm_user":
        return {
          ok: false,
          content: "Development NoPerms User",
          short: "No Repo Access",
        };

      default:
        return {
          ok: false,
          content: "Server in Dev Mode passed unhandled user",
          short: "Server Error",
        };
    }
  }

  let withinPackages = await doesUserHaveRepo(user, repo);

  // doesUserHaveRepo returns several different results, which need to be checked for
  if (withinPackages.ok) {
    // if the user has access directly return withinPackages
    return withinPackages;
  }

  // if the user doesn't have access check one of the many returns
  switch (withinPackages.short) {
    case "No Access":
      // the user does not have any access to the repo.
      return { ok: false, short: "No Repo Access" };

    case "Failed Request":
      // the request returned an unexpected error. For now return error
      return {
        ok: false,
        short: "Server Error",
        content: "GitHub Returned an unexpected error.",
      };

    case "Server Error":
      // an error occured.
      return {
        ok: false,
        short: "Server Error",
        content: withinPackages.content,
      };

    case "No Auth":
      // the token used is invalid
      // TODO: properly handle token refresh.
      return {
        ok: false,
        short: "Server Error",
        content: "Unrefreshed token.",
      };

    default:
      // unkown short provided
      return {
        ok: false,
        short: "Server Error",
        content: "Unkown short provided during git.Ownership",
      };
  }
}

/**
 * @async
 * @function createPackage
 * @desc Creates a compatible `Server Object Full` object, from only receiving a `repo` as in
 * `owner/repo`. With this it contacts GitHub API's and modifies data as needed to
 * return back a proper `Server Object Full` object within a `Server Status`.content object.
 * @param {string} repo - The Repo to use in the form `owner/repo`.
 * @returns {object} A `Server Status` Object where `content` is the `Server Package Full` object.
 */
async function createPackage(repo, user) {
  try {
    let newPack = {};
    // this ^^^ will be what we append all data to.
    let exists = await getRepoExistance(repo, user);

    if (!exists) {
      // this could be because of an error, or it truly doesn't exist.
      return {
        ok: false,
        content: `Failed to get repo: ${repo}`,
        short: "Bad Repo",
      };
    }

    let pack = await getPackageJSON(repo, user);

    if (pack === undefined) {
      return {
        ok: false,
        content: `Failed to get gh package.`,
        short: "Bad Package",
      };
    }

    let repoTag = await getRepoTags(repo, user);

    if (repoTag === undefined) {
      return {
        ok: false,
        content: "Failed to get gh tags.",
        short: "Server Error",
      };
    }

    // now to get our readme
    let readme = await getRepoReadMe(repo, user);

    if (readme === undefined) {
      return {
        ok: false,
        content: "Failed to get gh readme.",
        short: "Bad Repo",
      };
    }

    // Now we should be ready to create the package.
    // readme = The Text data of the current repo readme.
    // repoTag = the API JSON response for repo tags, including the tags, and their sha hash, and tarball_url
    // pack = the package.json file within the repo, as JSON.
    // And we want to funnel all of this data into newPack and return it.

    const time = Date.now();

    // One note about the difference in atom created package.json files, is the 'repository'
    // is an object rather than a string like NPM.
    newPack.name = pack.name;
    //newPack.repository = pack.repository; // the auto gen package.json does not include the repo in a valid format.
    newPack.created = time;
    newPack.updated = time;
    newPack.creation_method = "User Made Package";
    newPack.downloads = 0;
    newPack.stargazers_count = 0;
    newPack.star_gazers = [];
    newPack.readme = readme;
    newPack.metadata = pack; // The metadata tag is the most recent package.json file, in full.

    // currently there is no purpose to store the type of repo. But for the time being,
    // we will assume this could be used in the future as a way to determine how to interact with a repo.
    // The functionality will only be declarative for now, and may change later on.
    // Although first party packages do already have the regular package object. So we
    // will need to check if its an object or string.
    if (typeof pack.repository !== "string") {
      newPack.repository = pack.repository; // likely a first party package, with an
      // already valid package object, that can just be added over.
    } else if (pack.repository.includes("github")) {
      newPack.repository = {
        type: "git",
        url: pack.repository,
      };
    } else if (pack.repository.includes("bitbucket")) {
      newPack.repository = {
        type: "bit",
        url: pack.repository,
      };
    } else if (pack.repository.includes("sourceforge")) {
      newPack.repository = {
        type: "sfr",
        url: pack.repository,
      };
    } else if (pack.repository.includes("gitlab")) {
      newPack.repository = {
        type: "lab",
        url: pack.repository,
      };
    } else {
      newPack.repository = {
        type: "na",
        url: pack.repository,
      };
    }

    newPack.versions = {};

    // now during migration packages will have a 'versions' key, but otherwise the standard
    // package will just have a 'version', so we will check which is present.
    if (pack.versions) {
      // now to add the release data to each release within the package
      for (const ver of Object.keys(pack.versions)) {
        for (const tag of repoTag) {
          const shortTag = tag.name.replace("v", "");
          if (ver == shortTag) {
            // they match tag and version, stuff the data into the package.
            newPack.versions[ver] = pack;
            // TODO::
            // Its worthy to note that ^^^ assigns the current package.json file within the repo
            // as the version tag. Now this in most cases during a publish should be fine.
            // But if a user were to publish a version to the backend AFTER having published several
            // versions to their repo, this would cause identical versions to be created, although
            // would have the correct download URL. So the error would only be visual when browsing
            // the packages details.
            newPack.versions[ver].tarball_url = tag.tarball_url;
            newPack.versions[ver].sha = tag.commit.sha;
          }
        }
      }
    } else if (pack.version) {
      newPack.versions[pack.version] = pack;
      // Otherwise if they only have a version tag, we can make the first entry onto the versions.
      // This first entry of course, contains the package.json currently, and in the future,
      // will allow modifications.
      // But now we do need to retreive, the tarball data.
      for (const tag of repoTag) {
        const shortTag = tag.name.replace("v", "");
        if (pack.version == shortTag) {
          newPack.versions[pack.version].tarball_url = tag.tarball_url;
          newPack.versions[pack.version].sha = tag.commit.sha;
        }
      }
    }

    // now with all the versions properly filled, we lastly just need the release data.
    newPack.releases = {
      latest: repoTag[0].name.replace("v", ""),
    };

    // for this we just use the most recent tag published to the repo.
    // and now the object is complete, lets return the pack, as a Server Status Object.
    return { ok: true, content: newPack };
  } catch (err) {
    // an error occured somewhere during package generation
    return { ok: false, content: err, short: "Server Error" };
  }
}

/**
 * @async
 * @function doesUserHaveRepo
 * @desc Unexported function, that determines if the specified user has access
 * to the specified repository. Will loop itself through all valid pages
 * of users repo list, until it finds a match, otherwise returning accordingly.
 * @param {object} user - A valid user object, from the user file.
 * @param {string} repo - The valid repo in the format `owner/repo`
 * @param {int} [page] - Not intended to be set directly, but is used to track the
 * current results page number, if or when the function needs to loop itself.
 * @returns {object} A server status object of true if they do have access.
 * And returns false in all other situations.
 */
async function doesUserHaveRepo(user, repo, page = 1) {
  try {
    const res = await superagent
      .get(`${GH_API_URL}/user/repos?page=${page}`)
      .set({
        Authorization: `Bearer ${user.token}`,
      })
      .set({ "User-Agent": GH_USERAGENT });

    if (res.status !== 200) {
      // we have not received 200 code: return a failure.
      return { ok: false, short: "Failed Request" };
    }

    for (let i = 0; i < res.body.length; i++) {
      if (res.body[i].full_name === repo) {
        return { ok: true, content: res.body[i] };
      }
    }

    // After going through every repo returned, we haven't found a repo
    // the user owns. Lets check if theres multiple pages of returns.
    const nextpage = page + 1;
    if (res.headers.link.includes("?page=" + nextpage)) {
      // if the link headers on the page include the query parameter
      // of the next page number
      return await doesUserHaveRepo(user, repo, nextpage);
    }

    // if there are no increasing pages, return no access
    return { ok: false, short: "No Access" };
  } catch (err) {
    if (err.status == 401) {
      return { ok: false, short: "No Auth" };
    }

    return { ok: false, short: "Server Error", content: err };
  }
}

/**
 * @async
 * @function getRepoExistance
 * @desc Intends to determine if a repo exists, or at least is accessible and public
 * on GitHub.
 * @param {string} repo - A repo in the format `owner/repo`.
 * @returns {boolean} A true if the repo exists, false otherwise. Including an error.
 */
async function getRepoExistance(repo, user) {
  try {
    const res = await superagent
      .get(`${GH_WEB_URL}/${repo}`)
      .set({ Authorization: `Bearer ${user.token}` })
      .set({ "User-Agent": GH_USERAGENT });

    switch (res.status) {
      case 200:
        return true;
      case 404:
      default:
        return false;
    }
  } catch (err) {
    logger.warningLog(
      null,
      null,
      `Unable to check if repo exists. ${repo} - ${err}`
    );
    return false;
  }
}

/**
 * @async
 * @function getPackageJSON
 * @desc Intends to retreive the raw text of the GitHub repo package.
 * @param {string} repo - The string of the repo in format `owner/repo`.
 * @returns {string|undefined} Returns a proper string of the readme if successful.
 * And returns `undefined` otherwise.
 */
async function getPackageJSON(repo, user) {
  try {
    const res = await superagent
      .get(`${GH_API_URL}/repos/${repo}/contents/package.json`)
      .set({ Authorization: `Bearer ${user.token}` })
      .set({ "User-Agent": GH_USERAGENT });

    switch (res.status) {
      case 200:
        return JSON.parse(
          Buffer.from(res.body.content, res.body.encoding).toString()
        );

      default:
        logger.warningLog(
          null,
          null,
          `Unable to Get ${repo} from GH for package.json. HTTP Status ${res.status}`
        );
        return undefined;
    }
  } catch (err) {
    logger.warningLog(
      null,
      null,
      `Failed to Get ${repo} from GH for package.json. Err: ${err}`
    );
    return undefined;
  }
}

/**
 * @async
 * @function getRepoReadMe
 * @desc Intends to retreive the GitHub repo readme file. Will look for both
 * `readme.md` and `README.md` just in case.
 * @param {string} repo - A valid repo in format `owner/repo`.
 * @returns {string|undefined} Returns the raw string of the readme if available,
 * otherwise returns undefined.
 */
async function getRepoReadMe(repo, user) {
  try {
    const res = await superagent
      .get(`${GH_API_URL}/repos/${repo}/contents/README.md`)
      .set({ Authorization: `Bearer ${user.token}` })
      .set({ "User-Agent": GH_USERAGENT });

    switch (res.status) {
      case 200:
        return Buffer.from(res.body.content, res.body.encoding).toString();

      default:
        logger.warningLog(
          null,
          null,
          `Unexpected Status Code during README.md retrevial: ${res}`
        );
        return undefined;
    }
  } catch (err) {
    logger.warningLog(
      null,
      null,
      `Unable to get ${repo} from GH for README.md, trying readme.md: Err: ${err}`
    );

    // since this can fail, on a 404, lets check for a lowercase readme
    if (err.status !== 404) {
      // Generic error code. Respond with undefined
      logger.warningLog(
        null,
        null,
        `Unable to Get ${repo} from GH for README.md. Err: ${err}`
      );
      return undefined;
    }

    // then this is not found, and we should try again for the lowercase readme.md
    try {
      const resLower = await superagent
        .get(`${GH_API_URL}/repos/${repo}/contents/readme.md`)
        .set({ Authorization: `Bearer ${user.token}` })
        .set({ "User-Agent": GH_USERAGENT });

      switch (resLower.status) {
        case 200:
          return Buffer.from(
            resLower.body.content,
            resLower.body.encoding
          ).toString();

        default:
          // it returned, but not the error code we expect.
          logger.warningLog(
            null,
            null,
            `Unexpected Status code during readme.md retrevial: ${resLower}`
          );
          return undefined;
      }
    } catch (err) {
      logger.warningLog(
        null,
        null,
        `Unable to get ${repo} from GH for readme.md. Err: ${err}`
      );
      return undefined;
    }
  }
}

/**
 * @async
 * @function getRepoTags
 * @desc Intends to get all tags associated with a repo. Since this is how APM
 * natively publishes new package versions on GitHub.
 * @param {string} repo - A valid repo in format `owner/repo`.
 * @returns {object|undefined} Returns the JSON parsed object of all tags if successful,
 * and returns undefined otherwise.
 * @see https://docs.github.com/en/rest/repos/repos#list-repository-tags
 */
async function getRepoTags(repo, user) {
  try {
    const res = await superagent
      .get(`${GH_API_URL}/repos/${repo}/tags`)
      .set({ Authorization: `Bearer ${user.token}` })
      .set({ "User-Agent": GH_USERAGENT });

    switch (res.status) {
      case 200:
        return res.body;

      default:
        logger.warningLog(
          null,
          null,
          `Unable to Get ${repo} from GH for Tags. HTTP Status ${res.status}`
        );
        return undefined;
    }
  } catch (err) {
    logger.warningLog(
      null,
      null,
      `Failed to Get ${repo} from GH for Tags. Err: ${err}`
    );
    return undefined;
  }
}

module.exports = {
  ownership,
  createPackage,
  getPackageJSON,
  setGHAPIURL,
  setGHWebURL,
};
