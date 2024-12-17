import { expect, jest } from "@jest/globals";

import childProcess from "child_process";

describe("isOnVpn", () => {

    const execSpy = jest.spyOn(childProcess, "execSync");
    let isOnVpn;

    beforeEach(async () => {
        jest.resetAllMocks();

        execSpy.mockReturnValue(Buffer.from("", "utf8"));
        process.env.CH_PROXY_HOST = "websenseproxy.internal.ch";
        ({ isOnVpn } = await import("./../../src/helpers/vpn-check.js"));
    });

    it("calls exec ping", () => {
        isOnVpn();
        expect(execSpy).toHaveBeenCalledWith("ping -c 3 websenseproxy.internal.ch");
    });

    it("returns false when ping fails", () => {
        execSpy.mockImplementation((_, __) => {
            throw new Error("Command failed: ping");
        });

        expect(isOnVpn()).toBe(false);
    });

    it("returns true when ping succeeds", () => {
        execSpy.mockReturnValue(Buffer.from(`PING websenseproxy.internal.ch (172.16.200.196): 56 data bytes
64 bytes from 172.16.200.196: icmp_seq=0 ttl=62 time=16.702 ms
64 bytes from 172.16.200.196: icmp_seq=1 ttl=62 time=19.661 ms
64 bytes from 172.16.200.196: icmp_seq=2 ttl=62 time=19.282 ms

--- websenseproxy.internal.ch ping statistics ---
3 packets transmitted, 3 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 16.702/18.548/19.661/1.315 ms`, "utf8"));

        expect(isOnVpn()).toBe(true);
    });

    it("returns false when ping loses all packets", () => {
        execSpy.mockReturnValue(Buffer.from(`PING websenseproxy.internal.ch (172.16.200.196): 56 data bytes

--- websenseproxy.internal.ch ping statistics ---
3 packets transmitted, 0 packets received, 100.0% packet loss
round-trip min/avg/max/stddev = 16.702/18.548/19.661/1.315 ms`, "utf8"));

        expect(isOnVpn()).toBe(false);
    });

});
