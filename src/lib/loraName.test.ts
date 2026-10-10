import { describe, expect, it } from "vitest";
import { shortLora } from "./loraName";

describe("shortLora", () => {
  it("shortens a published basename to version and label", () => {
    expect(shortLora("Joana_v3_e03")).toBe("v3·e03");
    expect(shortLora("DavidJoana_v1_final")).toBe("v1·final");
    expect(shortLora("pay_v2_e11")).toBe("v2·e11");
  });
  it("leaves a name it does not recognise alone", () => {
    expect(shortLora("k3lly_custom")).toBe("k3lly_custom");
    expect(shortLora(null)).toBeNull();
  });
});
