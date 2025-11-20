import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Legend, AreaChart, Area } from 'recharts';
import { Cpu, ZoomIn, Zap, RefreshCw, Calculator, ArrowRight, Scale } from 'lucide-react';

// --- 模拟逻辑 ---

// E2M1 (4-bit) 的归一化查找表 (模拟值，非严格 IEEE，用于演示动态范围)
const E2M1_VALUES = [
    0.0,      // 0000
    0.0625,   // 0001 (Subnormal)
    0.09375,  // 0010
    0.125,    // 0011
    0.1875,   // 0100
    0.25,     // 0101
    0.375,    // 0110
    0.5,      // 0111
    0.75,     // 1000 (High range start)
    1.0       // 1001
];

// 模拟位结构解释 (用于 UI 展示计算过程)
const BIT_EXPLANATIONS = [
    { bits: "00", formula: "0", desc: "Zero" },
    { bits: "01", formula: "2⁻⁴ × 1", desc: "Smallest (Subnormal)" }, // 0.0625
    { bits: "10", formula: "2⁻³ × 0.75", desc: "Small" },
    { bits: "11", formula: "2⁻³ × 1.0", desc: "Normal" },
    { bits: "00", formula: "...", desc: "..." }, // 简化展示
];

// 寻找最近的 E2M1 值
const quantizeE2M1 = (normalizedValue) => {
    const absVal = Math.abs(normalizedValue);
    let bestMatch = E2M1_VALUES[0];
    let minDiff = Math.abs(absVal - bestMatch);
    let bestIndex = 0;

    for (let i = 1; i < E2M1_VALUES.length; i++) {
        const diff = Math.abs(absVal - E2M1_VALUES[i]);
        if (diff < minDiff) {
            minDiff = diff;
            bestMatch = E2M1_VALUES[i];
            bestIndex = i;
        }
    }

    return {
        val: Math.sign(normalizedValue) * bestMatch,
        bits: generateFakeBits(normalizedValue, bestIndex),
        index: bestIndex
    };
};

// 生成模拟的 4-bit 二进制串
const generateFakeBits = (val, magnitudeIndex) => {
    if (val === 0) return "0000";
    const sign = val >= 0 ? "0" : "1";
    // 简单映射：magnitudeIndex 越大，指数/尾数位越大
    const binary = (magnitudeIndex).toString(2).padStart(3, '0');
    return sign + binary;
};

const generateData = (hasOutlier = false) => {
    const data = [];
    for (let i = 0; i < 32; i++) {
        // 生成正态分布数据
        let val = (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 3;
        data.push(val);
    }
    if (hasOutlier) {
        data[15] = 2.8; // 注入一个显著的异常值
    }
    return data;
};

const MXFP4Visualizer = () => {
    const [originalData, setOriginalData] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [hasOutlier, setHasOutlier] = useState(false);

    useEffect(() => {
        setOriginalData(generateData(hasOutlier));
    }, [hasOutlier]);

    const processedData = useMemo(() => {
        // Fix: Initialize with scaleMX and scaleInt4 to prevent undefined access during first render
        if (originalData.length === 0) return { scaleMX: 1, scaleInt4: 1, elements: [] };

        // --- 1. MXFP4 处理 ---
        const maxAbs = Math.max(...originalData.map(Math.abs));
        let scaleMX = Math.pow(2, Math.ceil(Math.log2(maxAbs || 1e-9)));

        // --- 2. INT4 处理 (Block-wise) ---
        // INT4 范围 -8 到 7。通常 Scale = MaxAbs / 7
        const scaleInt4 = maxAbs / 7;

        const elements = originalData.map((val, idx) => {
            // MXFP4
            const normMX = val / scaleMX;
            const quantMX = quantizeE2M1(normMX);
            const reconMX = quantMX.val * scaleMX;

            // INT4
            // 量化：Round(val / scale) -> Clamp -> Dequant: int * scale
            const intVal = Math.round(val / scaleInt4);
            const clampedInt = Math.max(-8, Math.min(7, intVal));
            const reconInt4 = clampedInt * scaleInt4;

            return {
                id: idx,
                original: val,

                // MXFP4 Data
                mxfp4: {
                    bits: quantMX.bits,
                    mantissaVal: quantMX.val,
                    reconstructed: reconMX,
                    error: Math.abs(val - reconMX),
                    index: quantMX.index
                },

                // INT4 Data
                int4: {
                    integer: clampedInt,
                    reconstructed: reconInt4,
                    error: Math.abs(val - reconInt4)
                }
            };
        });

        return { scaleMX, scaleInt4, elements };
    }, [originalData]);

    const selectedElement = processedData.elements[selectedIndex];

    // 用于拆解 bits 的显示
    const getBitParts = (bits) => {
        if (!bits) return { s: '0', e: '00', m: '0' };
        return {
            s: bits[0],
            e: bits.substring(1, 3),
            m: bits[3]
        };
    };

    const bitParts = selectedElement ? getBitParts(selectedElement.mxfp4.bits) : { s: '0', e: '00', m: '0' };

    const chartData = processedData.elements.map(el => ({
        name: el.id,
        Original: el.original,
        MXFP4: el.mxfp4.reconstructed,
        INT4: el.int4.reconstructed,
        ErrorMX: el.mxfp4.error,
        ErrorINT: el.int4.error
    }));

    return (
        <div className="flex flex-col w-full max-w-6xl mx-auto bg-slate-50 p-4 rounded-xl shadow-sm text-slate-800 font-sans">

            {/* Header */}
            <div className="mb-6 border-b border-slate-200 pb-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-indigo-900 flex items-center gap-2">
                        <Cpu className="w-8 h-8" />
                        MXFP4 vs INT4: 精度与位级原理
                    </h1>
                    <p className="text-slate-600 mt-1 text-sm">
                        Block 级量化对比实验：观察异常值如何摧毁 INT4 精度，以及 FP4 如何通过浮点机制幸存。
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setHasOutlier(false)}
                        className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors ${!hasOutlier ? 'bg-indigo-600 text-white' : 'bg-white border hover:bg-slate-100'}`}
                    >
                        <RefreshCw size={14} /> 标准分布
                    </button>
                    <button
                        onClick={() => setHasOutlier(true)}
                        className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors ${hasOutlier ? 'bg-red-600 text-white' : 'bg-white border hover:bg-red-50'}`}
                    >
                        <Zap size={14} /> 注入异常值
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

                {/* Left: Bit Decoder & Math Explanation */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-indigo-100 lg:col-span-2 flex flex-col">
                    <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Calculator size={16} /> 4-Bit 计算过程解剖 (Index: {selectedIndex})
                    </h3>

                    {selectedElement && (
                        <div className="flex flex-col gap-6">

                            {/* 1. The Bits Visualization */}
                            <div className="flex items-center gap-4 bg-slate-100 p-3 rounded-lg justify-center">
                                <div className="text-xs text-slate-500 font-mono mr-2">Raw Bits:</div>
                                <div className="flex flex-col items-center">
                                    <div className="w-8 h-8 bg-blue-500 text-white flex items-center justify-center rounded font-mono font-bold text-lg">{bitParts.s}</div>
                                    <span className="text-[10px] text-blue-600 mt-1 font-bold">Sign</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <div className="flex gap-1">
                                        <div className="w-8 h-8 bg-emerald-500 text-white flex items-center justify-center rounded font-mono font-bold text-lg">{bitParts.e[0]}</div>
                                        <div className="w-8 h-8 bg-emerald-500 text-white flex items-center justify-center rounded font-mono font-bold text-lg">{bitParts.e[1]}</div>
                                    </div>
                                    <span className="text-[10px] text-emerald-600 mt-1 font-bold">Exponent</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <div className="w-8 h-8 bg-purple-500 text-white flex items-center justify-center rounded font-mono font-bold text-lg">{bitParts.m}</div>
                                    <span className="text-[10px] text-purple-600 mt-1 font-bold">Mantissa</span>
                                </div>
                            </div>

                            {/* 2. Mathematical Breakdown */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Formula View */}
                                <div className="bg-indigo-50 p-3 rounded border border-indigo-100 text-sm relative">
                                    <div className="absolute top-0 right-0 bg-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded-bl">E2M1 解码逻辑</div>
                                    <div className="font-mono text-slate-600 mb-1">Value = Sign × 2<sup>Exp</sup> × Mantissa</div>
                                    <div className="mt-2 space-y-1 font-mono text-xs">
                                        <div className="flex justify-between"><span className="text-blue-600">Sign ({bitParts.s}):</span> <span>{bitParts.s === '0' ? '+' : '-'}1</span></div>
                                        <div className="flex justify-between"><span className="text-emerald-600">Exp ({bitParts.e}):</span> <span>{bitParts.e === '00' ? 'Subnormal (2⁻²)' : 'Normal (2^E...)'}</span></div>
                                        <div className="flex justify-between"><span className="text-purple-600">Mantissa ({bitParts.m}):</span> <span>{bitParts.e === '00' ? `0.${bitParts.m}` : `1.${bitParts.m}`}</span></div>
                                    </div>
                                    <div className="mt-3 pt-2 border-t border-indigo-200 flex justify-between items-center font-bold text-indigo-900">
                                        <span>Local Value:</span>
                                        <span>{selectedElement.mxfp4.mantissaVal.toFixed(5)}</span>
                                    </div>
                                </div>

                                {/* Comparison View */}
                                <div className="bg-slate-50 p-3 rounded border border-slate-200 text-sm flex flex-col justify-between">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="font-bold text-slate-600">MXFP4 vs INT4 结果</span>
                                    </div>

                                    {/* MXFP4 Result */}
                                    <div className="flex justify-between items-center mb-2 bg-white p-2 rounded border border-indigo-100">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-indigo-500 font-bold">MXFP4 (Float)</span>
                                            <span className="text-xs text-slate-400">Scale: {processedData.scaleMX.toFixed(1)}</span>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-mono font-bold text-indigo-700">{selectedElement.mxfp4.reconstructed.toFixed(4)}</div>
                                            <div className="text-[10px] text-slate-500">Err: {selectedElement.mxfp4.error.toFixed(5)}</div>
                                        </div>
                                    </div>

                                    {/* INT4 Result */}
                                    <div className="flex justify-between items-center bg-white p-2 rounded border border-orange-100">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-orange-500 font-bold">INT4 (Integer)</span>
                                            <span className="text-xs text-slate-400">Scale: {processedData.scaleInt4.toFixed(2)}</span>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-mono font-bold text-orange-700">{selectedElement.int4.reconstructed.toFixed(4)}</div>
                                            <div className={`text-[10px] font-bold ${selectedElement.int4.error > selectedElement.mxfp4.error ? 'text-red-500' : 'text-green-500'}`}>
                                                Err: {selectedElement.int4.error.toFixed(5)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}
                </div>

                {/* Right: The Scale Info */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-indigo-100 lg:col-span-1 flex flex-col justify-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Scale size={100} />
                    </div>
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Block Shared Scale</h3>

                    <div className="mb-6">
                        <div className="text-xs text-slate-400 uppercase">MXFP4 Scale (Powers of 2)</div>
                        <div className="text-3xl font-mono font-bold text-indigo-600">
                            {processedData.scaleMX.toExponential(2)}
                        </div>
                        <div className="text-xs text-indigo-400 mt-1">
                            Always 2^k. simple bit-shift in hardware.
                        </div>
                    </div>

                    <div>
                        <div className="text-xs text-slate-400 uppercase">INT4 Scale (Linear)</div>
                        <div className="text-3xl font-mono font-bold text-orange-600">
                            {processedData.scaleInt4.toExponential(2)}
                        </div>
                        <div className="text-xs text-orange-400 mt-1">
                            MaxVal / 7. Depends heavily on outlier.
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid Visualization */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                        Memory Block (Click to inspect)
                    </h3>
                    <div className="flex gap-4 text-xs">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-indigo-500 rounded"></div> MXFP4 Winner</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-orange-500 rounded"></div> INT4 Winner</div>
                    </div>
                </div>

                <div className="grid grid-cols-8 gap-2">
                    {processedData.elements.map((el) => {
                        const isMXBetter = el.mxfp4.error <= el.int4.error;
                        return (
                            <div
                                key={el.id}
                                onClick={() => setSelectedIndex(el.id)}
                                className={`
                  relative h-14 rounded border-2 cursor-pointer transition-all duration-200 flex flex-col items-center justify-center overflow-hidden
                  ${selectedIndex === el.id ? 'border-blue-500 ring-2 ring-blue-100 z-10 scale-105 bg-white' : 'border-slate-100 bg-slate-50 hover:bg-slate-100'}
                `}
                            >
                                {/* Color indicator for accuracy winner */}
                                <div className={`absolute bottom-0 w-full h-1 ${isMXBetter ? 'bg-indigo-400' : 'bg-orange-400'}`}></div>

                                <span className={`text-[10px] font-mono ${Math.abs(el.original) > 1.0 ? 'font-bold text-red-600' : 'text-slate-500'}`}>
                                    {el.original.toFixed(2)}
                                </span>
                                {/* Visual dots for magnitude */}
                                <div className="flex gap-0.5 mt-1">
                                    {[...Array(4)].map((_, i) => (
                                        <div key={i} className={`w-1 h-1 rounded-full ${el.mxfp4.bits[i] === '1' ? 'bg-slate-800' : 'bg-slate-200'}`}></div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Charts: Reconstruction & Error */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-72">

                {/* Chart 1: Values Comparison */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                        数值还原对比 (Reconstruction)
                    </h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" hide />
                            <YAxis tick={{ fontSize: 10 }} />
                            <RechartsTooltip
                                contentStyle={{ fontSize: '11px', borderRadius: '6px' }}
                                formatter={(value) => value.toFixed(3)}
                            />
                            <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                            <Bar dataKey="Original" fill="#cbd5e1" name="Original" />
                            <Bar dataKey="MXFP4" fill="#6366f1" name="MXFP4" />
                            <Bar dataKey="INT4" fill="#f97316" name="INT4" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Chart 2: Error Comparison */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                        误差幅度对比 (Error Magnitude)
                    </h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" hide />
                            <YAxis tick={{ fontSize: 10 }} />
                            <RechartsTooltip
                                contentStyle={{ fontSize: '11px', borderRadius: '6px' }}
                                formatter={(value) => value.toFixed(4)}
                            />
                            <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                            <Area type="monotone" dataKey="ErrorINT" stackId="1" stroke="#f97316" fill="#fff7ed" name="INT4 Error" />
                            <Area type="monotone" dataKey="ErrorMX" stackId="2" stroke="#6366f1" fill="#e0e7ff" name="MXFP4 Error" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

            </div>

        </div>
    );
};

export default MXFP4Visualizer;