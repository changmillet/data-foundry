export function stageContract(stages) {
  return stages.map((stage) => ({
    stage: stage.stage,
    phase: stage.phase ?? stage.stage,
    purpose: stage.purpose,
    inputs: stage.inputs ?? [],
    outputs: stage.outputs ?? [],
    blockers: stage.blockers ?? [],
    artifacts: stage.artifacts ?? stage.outputs ?? [],
    side_effects: stage.side_effects ?? [],
    report_contract: stage.report_contract ?? {
      status: "required",
      counts: "required",
      files: "required",
      blockers: "required",
      remote_write_mode: "read-only",
    },
  }));
}

export function readOnlyStageContract(stages) {
  return {
    remote_write_mode: "read-only",
    stage_pipeline: stageContract(stages),
  };
}
