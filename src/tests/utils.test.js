jest.mock("../storage.js");
const getBanList = require("../storage.js").getBanList;

const utils = require("../utils.js");

describe("isPackageNameBanned Tests", () => {
  test("Returns true correctly for banned item", async () => {
    getBanList.mockResolvedValue({ ok: true, content: ["banned-item"] });
    let name = "banned-item";

    let isBanned = await utils.isPackageNameBanned(name);

    expect(isBanned.ok).toBeTruthy();
  });

  test("Returns false correctly for non-banned item", async () => {
    getBanList.mockResolvedValue({ ok: true, content: ["banned-item"] });
    let name = "not-banned-item";

    let isBanned = await utils.isPackageNameBanned(name);

    expect(isBanned.ok).toBeFalsy();
  });

  test("Returns true if no banned list can be retrieved", async () => {
    getBanList.mockResolvedValue({ ok: false });

    let isBanned = await utils.isPackageNameBanned("any");

    expect(isBanned.ok).toBeTruthy();
  });
});

describe("engineFilter returns version expected.", () => {
  test("Returns First Position when given multiple valid positions.", async () => {
    let pack = {
      versions: {
        "2.0.0": {
          version: "2.0.0",
          engines: {
            atom: ">1.0.0 <2.0.0",
          },
        },
        "1.9.9": {
          version: "1.9.9",
          engines: {
            atom: ">1.0.0 <2.0.0",
          },
        },
      },
    };

    let engine = "1.5.0";

    let res = await utils.engineFilter(pack, engine);
    expect(res.metadata.version == "2.0.0");
  });

  test("Returns Matching version when given an equal upper bound.", async () => {
    let pack = {
      versions: {
        "2.0.0": {
          version: "2.0.0",
          engines: {
            atom: ">=1.5.0 <2.0.0",
          },
        },
        "1.9.9": {
          version: "1.9.9",
          engines: {
            atom: ">1.0.0 <=1.4.9",
          },
        },
      },
    };

    let engine = "1.4.9";

    let res = await utils.engineFilter(pack, engine);
    expect(res.metadata.version == "1.9.9");
  });

  test("Returns First Matching version on lower bond equal.", async () => {
    let pack = {
      versions: {
        "2.0.0": {
          version: "2.0.0",
          engines: {
            atom: ">=1.2.3 <2.0.0",
          },
        },
        "1.0.0": {
          version: "1.0.0",
          engines: {
            atom: ">1.0.0 <1.2.3",
          },
        },
      },
    };

    let engine = "1.2.3";

    let res = await utils.engineFilter(pack, engine);
    expect(res.metadata.version == "2.0.0");
  });
});
