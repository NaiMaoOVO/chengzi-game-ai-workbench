function createGenerationGuard() {
  let generation = 0;
  return {
    next() {
      generation += 1;
      return generation;
    },
    isCurrent(value) {
      return value === generation;
    },
    current() {
      return generation;
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createGenerationGuard };
}
