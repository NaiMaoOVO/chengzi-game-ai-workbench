const NativeDate = Date;
const fixedNow = Number(process.env.GAMEOPS_TEST_FIXED_TIME);

if (Number.isFinite(fixedNow)) {
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }

    static now() {
      return fixedNow;
    }
  }

  global.Date = FixedDate;
}
