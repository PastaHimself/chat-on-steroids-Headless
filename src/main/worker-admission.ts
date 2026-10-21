import nodePath from 'node:path';
import { getConfig } from './config.js';
import { logWarn } from './logger.js';
import { stageSpawn, markStagedWorkerWorktree, persistCriticalSwarmNow, type SpawnInput } from './agents.js';
import { allocWorkerWorkspace, validateWorkerWorkspaceLease, WorkerWorktreeError, type WorkerWorktreeLease } from './worktrees/index.js';
import { isGitRepository } from './toolchain.js';
import { setWorkspaceFor } from './workspace.js';

/** Publish a staged broker mutation only after its exact revision is durable. */
export async function acceptAgentMutation(
  staged: { commit(): void | boolean; rollback(): void },
  failure: string,
  commitFailure: string = failure,
  admission?: { validate(): Promise<void>; assertCurrent(): void }
): Promise<void> {
  try {
    let durable: boolean;
    try {
      durable = await persistCriticalSwarmNow();
    } catch (error) {
      throw new Error(`${failure} (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!durable) throw new Error(failure);
    // The durable write itself awaits filesystem IO. Recheck live ownership after it,
    // then check the current policy synchronously beside the broker's commit.
    if (admission) {
      await admission.validate();
      admission.assertCurrent();
    }
    if (staged.commit() === false) throw new Error(commitFailure);
  } catch (error) {
    staged.rollback();
    if (admission) {
      // A rejected admission can happen after the persistence sink successfully wrote
      // the staged topology. Publish the compensating rollback before returning the
      // rejection, otherwise an immediate restart could restore unaccepted workers.
      try {
        if (!(await persistCriticalSwarmNow())) {
          throw new Error('the broker has no immediate durable persistence sink');
        }
      } catch (rollbackError) {
        throw new Error(`Worker admission rollback could not be made durable (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`);
      }
    }
    throw error;
  }
}


/** Shared admission for MCP and authenticated local operators. The broker remains the lifecycle owner. */
export async function admitWorkerSpawn(input: SpawnInput, options: {
  workspace(): Promise<{ real: string; virtual: string } | null>;
  canIsolate(): boolean;
  selectedWorkspace?: { real: string; virtual: string } | null;
  validateOwner?(): Promise<void>;
  assertCurrent?(): void;
}) {
  const staged = stageSpawn(input);
  // Newly staged admissions alone may own Git branches. A repeated spawn may show
  // existing workers in `created`, but must never reallocate their checkouts.
  const allocated: WorkerWorktreeLease[] = [];
  const admittedLeases: WorkerWorktreeLease[] = [];
  const isolationNotes: string[] = [];
  let sourceDirty = false;
  let allocationAttempted = false;
  try {
    if (staged.newlyStaged && getConfig().multiAgent.autoWorktrees === true) {
      // A selected Local Project is durable even before this prime has made its first
      // file call. Fetch that binding explicitly instead of relying on the cwd cache.
      const source = await options.workspace();
      // Unfiled chats without any selected/learned folder can still delegate ordinary
      // work. Once a source exists, a Git checkout must pass strict isolation checks.
      const onServer = !!source && getConfig().roots.some(root => root.remote &&
        (source.virtual === `/${root.name}` || source.virtual.startsWith(`/${root.name}/`)));
      if (!source) {
        isolationNotes.push('No workspace is selected; workers were spawned without isolated Git worktrees.');
      } else if (onServer) {
        isolationNotes.push('Workers in a project on a server share its folder; separate worktrees are only made for projects on this computer.');
      } else if (isGitRepository(source.real)) {
        if (!options.canIsolate()) {
          throw new Error('WORKTREE_PERMISSION_REQUIRED: worker isolation requires Command, Create and Edit, with Read-only disabled.');
        }
        for (const agentId of staged.newlyStagedWorkerIds) {
          allocationAttempted = true;
          const lease = await allocWorkerWorkspace({
            runId: staged.runId,
            agentId,
            primeWorkspace: source,
            approvedRoots: getConfig().roots
          });
          if (lease.newlyCreated) allocated.push(lease);
          // Allocation awaited Git with the then-current approved roots. Revocation,
          // rename or replacement during that wait must prevent worker admission.
          await validateWorkerWorkspaceLease(lease, getConfig().roots);
          admittedLeases.push(lease);
          sourceDirty ||= lease.sourceDirty;
          markStagedWorkerWorktree(staged.runId, agentId);
        }
        if (getConfig().multiAgent.autoWorktrees !== true) {
          throw new Error('WORKTREE_POLICY_CHANGED: automatic worker isolation was disabled during the spawn.');
        }
        isolationNotes.push(`${staged.newlyStagedWorkerIds.length} newly staged worker(s) received isolated Git worktrees.`);
        if (sourceDirty) {
          isolationNotes.push('Warning: the source checkout has uncommitted changes. Workers start from the committed Git base revision, so those uncommitted changes were not copied into their worktrees.');
        }
      } else {
        isolationNotes.push('The selected workspace is not a Git repository; no worktrees were allocated.');
      }
    }
    staged.prepareDurability();
    await acceptAgentMutation(staged,
      'The worker run could not cross its durable acceptance barrier. The spawn was rolled back; retry this same request.',
      undefined,
      {
        validate: async () => {
          await options.validateOwner?.();
          for (const lease of admittedLeases) {
            await validateWorkerWorkspaceLease(lease, getConfig().roots);
          }
        },
        assertCurrent: () => {
          options.assertCurrent?.();
          const liveConfig = getConfig();
          if (admittedLeases.length && liveConfig.multiAgent.autoWorktrees !== true) {
            throw new Error('WORKTREE_POLICY_CHANGED: automatic worker isolation was disabled during the spawn.');
          }
          for (const lease of admittedLeases) {
            if (!liveConfig.roots.some(root => root.name === lease.approvedRoot.name &&
              nodePath.resolve(root.path) === nodePath.resolve(lease.approvedRoot.path))) {
              throw new WorkerWorktreeError('WORKTREE_ROOT_CHANGED', 'the owning approved root was revoked during worker admission');
            }
          }
        }
      });
  } catch (error) {
    staged.rollback();
    // An unaccepted spawn never opened a worker chat, but user files can appear in a
    // checkout between a Git status check and `git worktree remove`. Even non-force
    // removal may erase ignored files. Retain these newly created leases on failure;
    // they are not broker-admitted and can be inspected/disposed of explicitly later.
    // In particular, a retry must not take another user's branch or remove its files.
    if (allocated.length) {
      const retained = allocated.map(lease => lease.worktreePath).join(', ');
      logWarn(`multi-agent: spawn failed (${error instanceof Error ? error.message : String(error)}); ${allocated.length} unaccepted managed worktree(s) retained for safe inspection: ${retained}`);
      throw new Error(`WORKTREE_ROLLBACK_RETAINED: ${allocated.length} unaccepted Git checkout(s) were kept to protect user files. Inspect the local app logs for their locations and the allocation error.`);
    }
    if (allocationAttempted) {
      // Even the first failed allocation can include a native path in a Git or
      // filesystem error (for example an unsafe managed parent directory).
      // Only a trusted worktree error code crosses the model-facing boundary.
      logWarn(`multi-agent: worker allocation failed: ${error instanceof Error ? error.message : String(error)}`);
      const code = error instanceof WorkerWorktreeError ? error.code : 'WORKTREE_ALLOCATION_FAILED';
      const hint = code === 'WORKTREE_STORAGE_UNAVAILABLE'
        ? 'Worker checkouts are kept next to the repository, inside an approved folder, so the approved folder must contain the repository rather than be it. Ask the user to approve the folder that contains this repository, or to turn off "Isolate new workers in Git worktrees" in Settings.'
        : 'See local app logs for details.';
      throw new Error(`${code}: isolated Git checkout allocation failed. ${hint} The worker spawn was rolled back.`);
    }
    throw error;
  }
  // Keep provisional workspaces out of the cwd cache until the broker has accepted
  // their owners. A failed stage retains its checkout but exposes no orphan cwd.
  for (const lease of admittedLeases) {
    setWorkspaceFor(`agent:${lease.runId}:${lease.agentId}`, lease.workspace);
  }
  if (options.selectedWorkspace) {
    for (const agentId of staged.newlyStagedWorkerIds) {
      if (!admittedLeases.some(lease => lease.agentId === agentId))
        setWorkspaceFor(`agent:${staged.runId}:${agentId}`, options.selectedWorkspace);
    }
  }
  return { ...staged, isolationNotes };
}
