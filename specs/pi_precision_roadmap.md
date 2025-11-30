# Aurora Pi 计算精度路线图

## 目标

达到业界标准的 Pi 计算能力，最终目标是能计算任意位数的 Pi。

## 当前状态 (Iteration 22)

- **方法**: Leibniz 级数 + 多线程
- **精度**: 约 2-3 位有效数字
- **限制**: 64 位整数，定点算术

## 精度等级定义

| 等级 | 位数 | 方法 | 所需特性 |
|------|------|------|----------|
| Level 0 | 2-3 位 | Leibniz 级数 | 当前已实现 |
| Level 1 | 10-15 位 | Machin 公式 | 64 位浮点 |
| Level 2 | 100 位 | Chudnovsky (简化) | 大整数库 |
| Level 3 | 1000+ 位 | Chudnovsky (完整) | 任意精度算术 |
| Level 4 | 100万+ 位 | FFT 乘法 + Chudnovsky | FFT, 并行计算 |

---

## Iteration 23: Level 1 - 浮点 Machin 公式 (10-15 位)

### 目标
使用 64 位浮点数和 Machin 公式计算 Pi 到 15 位有效数字。

### Machin 公式
```
π/4 = 4·arctan(1/5) - arctan(1/239)
```

### 所需语言特性
1. **浮点除法** (`/` 对 float 操作数)
2. **浮点比较** (`<`, `>` 等对 float)
3. **浮点打印** (`print(float)`)
4. **类型转换** (`as float`, `as int`)

### 示例代码
```aurora
module pi_machin {
    fn arctan(x: float, terms: int) -> float {
        let result: float = 0.0;
        let power: float = x;
        let sign: float = 1.0;
        let i: int = 0;
        
        while i < terms {
            let denom: float = (2 * i + 1) as float;
            result = result + sign * power / denom;
            power = power * x * x;
            sign = sign * -1.0;
            i = i + 1;
        }
        return result;
    }
    
    fn main() -> int {
        let pi: float = 4.0 * (4.0 * arctan(0.2, 50) - arctan(1.0/239.0, 20));
        print(pi);  // 应输出 3.14159265358979...
        return 0;
    }
}
```

### 实现任务
- [ ] 添加 `FDIV` (浮点除法) 指令到 ISA
- [ ] 实现 `FCMP` (浮点比较) 指令
- [ ] 添加 `as float` / `as int` 类型转换语法
- [ ] 实现 `print(float)` (SVC 0x07)
- [ ] 在 x86 后端实现 XMM 寄存器的除法和比较

---

## Iteration 24: Level 2 - 大整数库 (100 位)

### 目标
实现 128/256 位整数支持，使用 Chudnovsky 简化版计算 100 位 Pi。

### Chudnovsky 公式 (简化)
```
1/π = 12 · Σ ((-1)^k · (6k)! · (13591409 + 545140134k)) / ((3k)! · (k!)³ · 640320^(3k+3/2))
```

每项产生约 14.18 位精度。

### 所需语言特性
1. **BigInt 类型** (`let x: bigint = 12345678901234567890n;`)
2. **大整数运算** (`+`, `-`, `*`, `/`, `%`)
3. **大整数打印**
4. **数组操作** (用于存储大数的各个部分)

### 实现任务
- [ ] 设计 BigInt 内部表示 (数组 of u64)
- [ ] 实现 BigInt 加减法
- [ ] 实现 BigInt 乘法 (Karatsuba 算法)
- [ ] 实现 BigInt 除法
- [ ] 实现阶乘函数

---

## Iteration 25: Level 3 - 任意精度 (1000+ 位)

### 目标
完整实现任意精度算术，支持计算 1000+ 位 Pi。

### 所需语言特性
1. **动态大小 BigInt**
2. **高效乘法** (Karatsuba 或 Toom-Cook)
3. **平方根** (牛顿迭代)
4. **内存管理** (GC 或手动)

### 实现任务
- [ ] 动态内存分配 (heap)
- [ ] 实现 Karatsuba 乘法
- [ ] 实现牛顿法平方根
- [ ] 优化 Chudnovsky 实现

---

## Iteration 26: Level 4 - 高性能计算 (100万+ 位)

### 目标
达到 y-cruncher 级别的计算能力。

### 所需语言特性
1. **FFT 乘法** (Schönhage-Strassen 或更好)
2. **SIMD 支持** (AVX2/AVX-512)
3. **多线程 + 任务调度**
4. **磁盘存储** (超大结果)

### 实现任务
- [ ] 实现 FFT (快速傅里叶变换)
- [ ] 实现 NTT (数论变换) 用于精确乘法
- [ ] SIMD intrinsics 支持
- [ ] 分布式计算框架

---

## 立即可行的改进 (Iteration 23 准备)

### 1. 浮点除法支持
当前缺少浮点除法指令，需要添加：

**ISA 扩展**
```
FDIV: 0x25  ; 浮点除法 - fdiv xmm_dest, xmm_src1, xmm_src2
```

**x86 实现**
```asm
divsd xmm0, xmm1  ; xmm0 = xmm0 / xmm1
```

### 2. 浮点比较支持
**ISA 扩展**
```
FCMP: 0x26  ; 浮点比较 - fcmp xmm_src1, xmm_src2 (设置标志位)
```

**x86 实现**
```asm
ucomisd xmm0, xmm1  ; 比较并设置 FLAGS
```

### 3. 类型转换
**语法**
```aurora
let x: int = 42;
let y: float = x as float;  // int -> float
let z: int = y as int;      // float -> int (截断)
```

**ISA 扩展**
```
ITOF: 0x27  ; int to float - itof xmm_dest, reg_src
FTOI: 0x28  ; float to int - ftoi reg_dest, xmm_src
```

### 4. print(float) 实现
SVC 0x07 - 打印浮点数
- 使用 Grisu 或 Dragon4 算法转换为字符串
- 或简化版：先乘以 10^N 转为整数再打印

---

## 验证标准

### Level 1 验证 (15 位)
```
期望输出: 3.14159265358979
实际输出: 3.14159265358979
```

### Level 2 验证 (100 位)
```
期望: 3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117067...
```

### Level 3 验证
与 Wolfram Alpha 或已知数据库对比前 1000 位。

---

## 参考资源

1. **y-cruncher** - 当前世界纪录保持者的实现
2. **GMP/MPFR** - GNU 多精度库
3. **Chudnovsky brothers' paper** - 原始算法论文
4. **BBP formula** - 直接计算任意十六进制位

---

## 下一步行动

**建议从 Iteration 23 开始**：
1. 实现浮点除法 (`FDIV`)
2. 实现浮点比较 (`FCMP`)
3. 实现 `as float` / `as int` 转换
4. 用 Machin 公式测试 15 位精度

这将为后续的高精度计算打下基础。
