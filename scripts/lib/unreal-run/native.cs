using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace UnrealRun {
    public sealed class JobHandle : SafeHandleZeroOrMinusOneIsInvalid {
        public JobHandle() : base(true) {}
        protected override bool ReleaseHandle() { return CloseHandle(handle); }
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
    }
    public sealed class EngineJob : IDisposable {
        [StructLayout(LayoutKind.Sequential)] struct Limits {
            public long ProcessTime, JobTime;
            public uint Flags;
            public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
            public uint ActiveLimit;
            public UIntPtr Affinity;
            public uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] struct Counters {
            public ulong ReadCount, WriteCount, OtherCount, ReadBytes, WriteBytes, OtherBytes;
        }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
            public Limits Basic;
            public Counters Io;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential)] struct Accounting {
            public long User, Kernel, PeriodUser, PeriodKernel;
            public uint Faults, Total, Active, Terminated;
        }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern JobHandle CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool SetInformationJobObject(JobHandle job, int kind, ref ExtendedLimits limits, uint size);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool AssignProcessToJobObject(JobHandle job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool QueryInformationJobObject(JobHandle job, int kind, out Accounting accounting, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool QueryInformationJobObject(JobHandle job, int kind, IntPtr values, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool TerminateJobObject(JobHandle job, uint code);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool IsProcessInJob(IntPtr process, JobHandle job, out bool present);
        readonly JobHandle handle;
        public EngineJob() {
            // Null security attributes create a non-inheritable, unnamed handle.
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway flags.
            if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>())) {
                int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error);
            }
        }
        public void Assign(Process process) {
            if (!AssignProcessToJobObject(handle, process.Handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        public uint ActiveProcesses() {
            Accounting value;
            if (!QueryInformationJobObject(handle, 1, out value, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return value.Active;
        }
        public bool Contains(Process process) {
            bool present;
            if (!IsProcessInJob(process.Handle, handle, out present)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return present;
        }
        public uint LimitFlags() {
            int size=Marshal.SizeOf<ExtendedLimits>();
            IntPtr buffer=Marshal.AllocHGlobal(size);
            try {
                if (!QueryInformationJobObject(handle, 9, buffer, (uint)size, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                return Marshal.PtrToStructure<ExtendedLimits>(buffer).Basic.Flags;
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        public int[] ProcessIds() {
            for (int capacity=32; capacity<=65536; capacity*=2) {
                int bytes = 8 + capacity * IntPtr.Size;
                IntPtr buffer = Marshal.AllocHGlobal(bytes);
                try {
                    if (!QueryInformationJobObject(handle, 3, buffer, (uint)bytes, IntPtr.Zero)) {
                        int error=Marshal.GetLastWin32Error();
                        if (error==234) continue;
                        throw new Win32Exception(error);
                    }
                    int count=Marshal.ReadInt32(buffer,4);
                    if (count<0 || count>capacity) throw new InvalidOperationException("Invalid Job process count");
                    var ids=new int[count];
                    for (int i=0;i<count;i++) ids[i]=checked((int)Marshal.ReadIntPtr(buffer,8+i*IntPtr.Size).ToInt64());
                    return ids;
                } finally { Marshal.FreeHGlobal(buffer); }
            }
            throw new InvalidOperationException("Job process count exceeded the observation bound");
        }
        public void Terminate() {
            if (!TerminateJobObject(handle, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        public void Dispose() { handle.Dispose(); }
    }
}
