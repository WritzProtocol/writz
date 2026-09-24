declare module "snarkjs" {
  export interface Groth16ProofJSON {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }

  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: Groth16ProofJSON; publicSignals: string[] }>;
    verify(
      vkey: unknown,
      publicSignals: string[],
      proof: Groth16ProofJSON,
    ): Promise<boolean>;
  };
}
