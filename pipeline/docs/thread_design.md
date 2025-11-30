# Iteration 19 - Thread Support Design

## API 设计

### 语法
```aurora
// 创建线程运行函数
let handle: thread = spawn worker_func();

// 等待线程完成
join handle;

// 线程入口函数 (返回 int)
fn worker_func() -> int {
    // 线程代码
    return 0;
}
```

### 简化 MVP
由于线程间通信和同步较复杂，MVP 阶段:
1. `spawn func()` - 创建线程执行无参函数
2. `join handle` - 等待线程完成
3. 线程函数必须返回 int

## ISA 扩展

| 操作码 | 值 | 格式 | 描述 |
|--------|-----|------|------|
| SPAWN | 0x30 | `SPAWN r0, func` | 创建线程，句柄存入 r0 |
| JOIN | 0x31 | `JOIN r0` | 等待线程 r0 完成 |

## Windows 实现

### CreateThread
```c
HANDLE CreateThread(
  LPSECURITY_ATTRIBUTES   lpThreadAttributes,   // NULL
  SIZE_T                  dwStackSize,          // 0 (default)
  LPTHREAD_START_ROUTINE  lpStartAddress,       // 函数地址
  LPVOID                  lpParameter,          // NULL (无参数)
  DWORD                   dwCreationFlags,      // 0
  LPDWORD                 lpThreadId            // NULL
);
```

### WaitForSingleObject
```c
DWORD WaitForSingleObject(
  HANDLE hHandle,        // 线程句柄
  DWORD  dwMilliseconds  // INFINITE (0xFFFFFFFF)
);
```

## 实现步骤

1. **pe64_generator.js**: 添加 CreateThread, WaitForSingleObject 导入
2. **lexer.js**: 添加 spawn, join, thread 关键字
3. **parser_v2.js**: 解析 spawn/join 语句
4. **ir.js**: 添加 SpawnExpr, JoinStmt 节点
5. **codegen.js**: 生成 SPAWN, JOIN 指令
6. **native_compiler_win.js**: 实现 Windows API 调用

## 测试程序
```aurora
module test {
    fn worker() -> int {
        return 42;
    }
    
    fn main() -> int {
        let t: thread = spawn worker();
        join t;
        return 0;
    }
}
```
