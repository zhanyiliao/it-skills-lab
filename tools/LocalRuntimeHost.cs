using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

// The terminal owns this job handle. Windows closes it even if the terminal is
// forcibly terminated, which also ends the worker and all Node.js/MariaDB children.
public static class LocalRuntimeHost
{
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct StartupInfo {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public ushort ShowWindow, ReservedSize;
        public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    private delegate bool ControlHandler(uint signal);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetInformationJobObject(IntPtr job, int info, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity,
        IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory,
        ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetConsoleCtrlHandler(ControlHandler handler, bool add);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int kind);

    private static void Require(bool success) {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    private static string Quoted(string value) { return "\"" + value + "\""; }

    public static int Run(string powershell, string worker, string project)
    {
        string key;
        using (SHA256 hash=SHA256.Create()) {
            key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(project).ToUpperInvariant()))).Replace("-", "").Substring(0,24);
        }
        using (Mutex single=new Mutex(false, "Local\\ITSkillsLabRuntime-"+key)) {
            bool owned=false;
            try { owned=single.WaitOne(0); } catch (AbandonedMutexException) { owned=true; }
            if (!owned) {
                Console.Error.WriteLine("This project is already running. Use the existing terminal to stop it.");
                return 1;
            }
            try { return RunOwned(powershell, worker, project, key); }
            finally { single.ReleaseMutex(); }
        }
    }

    private static int RunOwned(string powershell, string worker, string project, string key)
    {
        IntPtr job=IntPtr.Zero;
        ProcessInfo process=new ProcessInfo();
        string eventName="Local\\ITSkillsLabRuntimeStop-"+key;
        using (EventWaitHandle stop=new EventWaitHandle(false,EventResetMode.ManualReset,eventName))
        using (ManualResetEvent interrupted=new ManualResetEvent(false))
        using (ManualResetEvent finished=new ManualResetEvent(false)) {
            ControlHandler handler=delegate(uint signal) {
                if (signal!=0 && signal!=1 && signal!=2 && signal!=5 && signal!=6) return false;
                interrupted.Set();
                if (signal==2 || signal==5 || signal==6) finished.WaitOne(4000);
                return true;
            };
            bool registered=false;
            try {
                job=CreateJobObject(IntPtr.Zero,null);
                Require(job!=IntPtr.Zero);
                ExtendedLimits limits=new ExtendedLimits();
                limits.Basic.Flags=0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))));
                Require(SetConsoleCtrlHandler(handler,true));
                registered=true;
                StartupInfo startup=new StartupInfo();
                startup.Size=(uint)Marshal.SizeOf(typeof(StartupInfo));
                startup.Flags=0x100; // STARTF_USESTDHANDLES, including redirected test output.
                startup.Input=GetStdHandle(-10);
                startup.Output=GetStdHandle(-11);
                startup.Error=GetStdHandle(-12);
                string command=Quoted(powershell)+" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "+Quoted(worker)+" -ControlEvent "+Quoted(eventName);
                // Suspend before assignment so no service can escape the job during startup.
                Require(CreateProcess(powershell,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,
                    0x00000004|0x00000200,IntPtr.Zero,project,ref startup,out process));
                if (!AssignProcessToJobObject(job,process.Process)) {
                    int error=Marshal.GetLastWin32Error();
                    TerminateProcess(process.Process,1);
                    throw new Win32Exception(error);
                }
                Require(ResumeThread(process.Thread)!=0xffffffff);
                while (WaitForSingleObject(process.Process,250)==258) {
                    if (interrupted.WaitOne(0)) {
                        Console.WriteLine("\nStop requested. Waiting for services to close...");
                        stop.Set();
                        if (WaitForSingleObject(process.Process,20000)==258)
                            Console.Error.WriteLine("Shutdown timed out; closing the service process group.");
                        break;
                    }
                }
                uint code;
                Require(GetExitCodeProcess(process.Process,out code));
                return code==259 ? 1 : (int)code;
            } finally {
                stop.Set();
                if (job!=IntPtr.Zero) CloseHandle(job);
                if (process.Thread!=IntPtr.Zero) CloseHandle(process.Thread);
                if (process.Process!=IntPtr.Zero) {
                    WaitForSingleObject(process.Process,5000);
                    CloseHandle(process.Process);
                }
                finished.Set();
                if (registered) SetConsoleCtrlHandler(handler,false);
                GC.KeepAlive(handler);
            }
        }
    }
}