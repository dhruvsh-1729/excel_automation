import { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { v4 as uuidv4 } from 'uuid';

type FilterCondition = {
  id: string;
  type: 'contains' | 'startsWith' | 'endsWith' | 'equals';
  value: string;
  negate: boolean;
};

type FilterGroup = {
  id: string;
  conditions: FilterCondition[];
  breakpoints: number[];
  filteredItems: string[];
};

type Subgroup = {
  suffix: string;
  items: string[];
  numbers: string[];
};

const ExcelReader = () => {
  const [groups, setGroups] = useState<FilterGroup[]>([]);
  const [originalData, setOriginalData] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [nextGroupId, setNextGroupId] = useState(1);
  const [fileName, setFileName] = useState('');
  const [baseNumber, setBaseNumber] = useState('13');

  const processedGroups = useMemo(() => {
    const remainingItems = new Set(originalData);
    
    return groups.map(group => {
      const filtered = Array.from(remainingItems).filter(item =>
        group.conditions.some(condition => {
          const itemLower = item.toLowerCase();
          const searchValue = condition.value.toLowerCase();

          let matches = false;
          switch (condition.type) {
            case 'contains': matches = itemLower.includes(searchValue); break;
            case 'startsWith': matches = itemLower.startsWith(searchValue); break;
            case 'endsWith': matches = itemLower.endsWith(searchValue); break;
            case 'equals': matches = itemLower === searchValue; break;
          }

          return condition.negate ? !matches : matches;
        })
      );

      filtered.forEach(item => remainingItems.delete(item));
      return { ...group, filteredItems: filtered };
    });
  }, [groups, originalData]);

  const items = useMemo(() => {
    return originalData.map((value, index) => {
      let number, source = 'unmatched';
      
      for (const group of processedGroups) {
        let currentIndex = 0;
        for (const bp of group.breakpoints) {
          const end = currentIndex + bp;
          const subgroupItems = group.filteredItems.slice(currentIndex, end);
          const itemIndex = subgroupItems.indexOf(value);
          
          if (itemIndex > -1) {
            const suffix = group.breakpoints.length > 0 
              ? String.fromCharCode(65 + group.breakpoints.indexOf(bp)) 
              : '';
            number = `${baseNumber}.${group.id}${suffix ? `${suffix}.` : '.'}${itemIndex + 1}`;
            source = group.id;
            break;
          }
          currentIndex = end;
        }
        
        if (source === 'unmatched') {
          const remaining = group.filteredItems.slice(currentIndex);
          const itemIndex = remaining.indexOf(value);
          if (itemIndex > -1) {
            const suffix = group.breakpoints.length > 0 
              ? String.fromCharCode(65 + group.breakpoints.length) 
              : '';
            number = `${baseNumber}.${group.id}${suffix ? `${suffix}.` : '.'}${itemIndex + 1}`;
            source = group.id;
          }
        }
        
        if (source !== 'unmatched') break;
      }
      
      return { id: `item-${index}`, value, source, number };
    });
  }, [originalData, processedGroups, baseNumber]);

  const totalMatched = useMemo(() => 
    processedGroups.reduce((sum, group) => sum + group.filteredItems.length, 0),
    [processedGroups]
  );

  const unmatchedCount = originalData.length - totalMatched;

  const addGroup = () => {
    const newGroup: FilterGroup = {
      id: nextGroupId.toString(),
      conditions: [{ id: uuidv4(), type: 'contains', value: '', negate: false }],
      breakpoints: [],
      filteredItems: []
    };
    setGroups(prev => [...prev, newGroup]);
    setNextGroupId(prev => prev + 1);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setError('Please upload a valid Excel file (.xlsx or .xls)');
      return;
    }
    setError('');
    setGroups([]);
    setOriginalData([]);
    setNextGroupId(1);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        const data = jsonData
          .map((row: any) => row[0]?.toString().trim())
          .filter(Boolean)
          .map((value, index) => ({ 
            id: `item-${index}-${value}`,
            value, 
            source: 'unmatched' 
          }));

        setOriginalData(data.map(i => i.value));
        // setItems(data);
        setGroups([]);
      } catch (err) {
        setError('Error reading file');
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
  const addConditionToGroup = (groupId: string) => {
    setGroups(prevGroups => prevGroups.map(group =>
      group.id === groupId
        ? {
            ...group,
            conditions: [...group.conditions, {
              id: uuidv4(),
              type: 'contains',
              value: '',
              negate: false
            }]
          }
        : group
    ));
  };
  
  const updateCondition = (groupId: string, conditionId: string, field: keyof FilterCondition, value: any) => {
    setGroups(prevGroups => prevGroups.map(group =>
      group.id === groupId
        ? {
            ...group,
            conditions: group.conditions.map(cond =>
              cond.id === conditionId ? { ...cond, [field]: value } : cond
            )
          }
        : group
    ));
  };
  
  const removeCondition = (groupId: string, conditionId: string) => {
    setGroups(prevGroups => prevGroups.map(group =>
      group.id === groupId
        ? {
            ...group,
            conditions: group.conditions.filter(c => c.id !== conditionId)
          }
        : group
    ));
  };

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    
    const newItems = Array.from(items);
    const [movedItem] = newItems.splice(result.source.index, 1);
    newItems.splice(result.destination.index, 0, movedItem);
    // setItems(newItems);
  };

  const exportData = (format: 'xlsx' | 'csv' | 'xls') => {
    const sheetData: any[][] = [];
    const headerRow: string[] = [];
    const allColumns: { numbers: string[]; items: string[] }[] = [];

    // Process groups
    processedGroups.forEach(group => {
      const subgroups = getSubgroups(group);
      const groupNumbers: string[] = [];
      const groupItems: string[] = [];

      subgroups.forEach((subgroup, subIndex) => {
        // Determine numbering format based on breakpoints
        const useSuffix = group.breakpoints.length > 0;

        subgroup.numbers.forEach((num, index) => {
          const baseNumbering = `${baseNumber}.${group.id}`;
          const numbering = useSuffix
            ? `${baseNumbering}${subgroup.suffix}.${index + 1}`
            : `${baseNumbering}.${index + 1}`;
          groupNumbers.push(numbering);
        });

        subgroup.items.forEach(item => groupItems.push(item));

        // Add empty row after subgroup except last
        if (subIndex < subgroups.length - 1) {
          groupNumbers.push('');
          groupItems.push('');
        }
      });

      allColumns.push({ numbers: groupNumbers, items: groupItems });
      headerRow.push(``, `${baseNumber}.${group.id}`);
    });

    // Process unmatched items
    const unmatchedItems = originalData.filter(item => 
      !processedGroups.some(group => group.filteredItems.includes(item))
    );
    const unmatchedNumbers = unmatchedItems.map((_, i) => `${baseNumber}.${nextGroupId}.${i + 1}`);
    
    if (unmatchedItems.length > 0) {
      allColumns.push({
        numbers: unmatchedNumbers,
        items: unmatchedItems
      });
      headerRow.push('', `${baseNumber}.${nextGroupId}`);
    }

    sheetData.push(headerRow);

    // Calculate max rows needed
    const maxRows = Math.max(...allColumns.map(col => col.numbers.length));

    // Build data rows
    for (let i = 0; i < maxRows; i++) {
      const row: any[] = [];
      allColumns.forEach(col => {
        row.push(col.numbers[i] || '');
        row.push(col.items[i] || '');
      });
      sheetData.push(row);
    }

    // Create and export workbook
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, fileName || 'Sheet1');
    XLSX.writeFile(wb, `${fileName || 'export'}.${format}`);
  };

  const addBreakpoint = (groupId: string) => {
    setGroups(prev => prev.map(g => 
      g.id === groupId ? { ...g, breakpoints: [...g.breakpoints, 1] } : g
    ));
  };

  const removeBreakpoint = (groupId: string, index: number) => {
    setGroups(prev => prev.map(g => 
      g.id === groupId ? { ...g, breakpoints: g.breakpoints.filter((_, i) => i !== index) } : g
    ));
  };

  const updateBreakpoint = (groupId: string, index: number, value: number) => {
    setGroups(prev => prev.map(g => 
      g.id === groupId ? { 
        ...g, 
        breakpoints: g.breakpoints.map((bp, i) => i === index ? Math.max(1, value) : bp) 
      } : g
    ));
  };

  const getSubgroups = (group: FilterGroup): Subgroup[] => {
    let currentIndex = 0;
    const subgroups: Subgroup[] = [];
    
    group.breakpoints.forEach((bp, idx) => {
      const end = currentIndex + bp;
      const items = group.filteredItems.slice(currentIndex, end);
      subgroups.push({
        suffix: String.fromCharCode(65 + idx),
        items,
        numbers: items.map((_, i) => `${baseNumber}.${group.id}${String.fromCharCode(65 + idx)}.${i + 1}`)
      });
      currentIndex = end;
    });

    if (currentIndex < group.filteredItems.length) {
      const items = group.filteredItems.slice(currentIndex);
      subgroups.push({
        suffix: String.fromCharCode(65 + group.breakpoints.length),
        items,
        numbers: items.map((_, i) => `${baseNumber}.${group.id}${String.fromCharCode(65 + group.breakpoints.length)}.${i + 1}`)
      });
    }

    return subgroups;
  };

  return (
    <div className="container mx-auto p-4">
      {/* Header Section */}
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <label className="block text-sm">
            File Name:
            <input type="text" value={fileName} onChange={e => setFileName(e.target.value)}
              className="ml-2 p-1 border rounded w-full" />
          </label>
          <label className="block text-sm">
            Base Number:
            <input type="text" value={baseNumber} onChange={e => setBaseNumber(e.target.value)}
              className="ml-2 p-1 border rounded w-full" />
          </label>
        </div>
        
        <div className="space-y-2">
          <label className="block text-sm">
            Upload Excel:
            <input type="file" accept=".xlsx,.xls" onChange={handleFile}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-1 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          </label>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
        
        <div className="space-y-2">
          <div className="text-sm">Total Items: {originalData.length}</div>
          <div className="text-sm">Matched Items: {totalMatched}</div>
          <div className="text-sm">Unmatched Items: {unmatchedCount}</div>
        </div>
      </div>

      {/* Groups Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-4">
        {groups.map(group => {
          const subgroups = getSubgroups(group);
          return (
            <div key={group.id} className="p-3 border rounded bg-gray-50">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-sm">Group {baseNumber}.{group.id}</h3>
                {/* <span className="text-xs text-gray-600">({group.filteredItems.length} items)</span> */}
              </div>
              
              {/* Breakpoints Section */}
              <div className="mb-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium">Subgroups:</span>
                  <button onClick={() => addBreakpoint(group.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">
                    Add Breakpoint
                  </button>
                </div>
                
                <div className="space-y-1">
                  {group.breakpoints.map((bp, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input type="number" value={bp} min="1"
                        onChange={e => updateBreakpoint(group.id, idx, parseInt(e.target.value))}
                        className="w-16 p-1 text-xs border rounded" />
                      <span className="text-xs">
                        {/* → {subgroups[idx]?.items.length} items */}
                      </span>
                      <button onClick={() => removeBreakpoint(group.id, idx)} className="text-xs bg-red-500 text-white px-2 py-1 rounded">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subgroups Preview */}
              {subgroups.length > 0 && (
                <div className="text-xs space-y-1">
                  {subgroups.map((sg, idx) => (
                    <div key={idx} className="flex justify-between items-center">
                      <span>{baseNumber}.{group.id}{sg.suffix}:</span>
                      {/* <span>{sg.items.length} items</span> */}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Export and Add Group Buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={addGroup} className="text-sm bg-green-500 text-white px-3 py-1 rounded">
          + Add Group
        </button>
        <button onClick={() => exportData('xlsx')} className="text-sm bg-purple-500 text-white px-3 py-1 rounded">
          Export XLSX
        </button>
          <button 
            onClick={() => exportData('csv')}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
          >
            Export CSV
          </button>
          <button 
            onClick={() => exportData('xls')}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
          >
            Export XLS
          </button>
        </div>
      
      <div className="grid grid-cols-3 gap-4 mb-8">
        {groups.map(group => (
          <div key={group.id} className="p-4 border rounded bg-gray-50">
            <div className="flex items-center mb-4">
              <h3 className="text-lg font-semibold mr-4">Group {baseNumber}.{group.id}</h3>
              <button 
                onClick={() => addConditionToGroup(group.id)}
                className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600"
              >
                Add Condition
              </button>
            </div>
            
            <div className="space-y-4">
              {group.conditions.map(condition => (
                <div key={condition.id} className="flex w-full gap-4 items-center">
                  <select
                    className="p-2 border rounded w-32"
                    value={condition.type}
                    onChange={(e) => updateCondition(group.id, condition.id, 'type', e.target.value)}
                  >
                    <option value="contains">Contains</option>
                    <option value="startsWith">Starts With</option>
                    <option value="endsWith">Ends With</option>
                    <option value="equals">Equals</option>
                  </select>

                  <input
                    type="text"
                    className="p-2 border rounded flex-1"
                    placeholder="Search value"
                    value={condition.value}
                    onChange={(e) => updateCondition(group.id, condition.id, 'value', e.target.value)}
                  />
<div className='flex flex-col gap-2'>
                  <label className="flex items-center gap-2 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={condition.negate}
                      onChange={(e) => updateCondition(group.id, condition.id, 'negate', e.target.checked)}
                      className="w-4 h-4"
                    />
                    Invert
                  </label>

                  <button
                    className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
                    onClick={() => setGroups(groups.map(g => 
                      g.id === group.id ? {
                        ...g,
                        conditions: g.conditions.filter(c => c.id !== condition.id)
                      } : g
                    ))}
                  >
                    Remove
                  </button>
                  </div>
                </div>
            ))}
            </div>
          </div>
        ))}
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="items">
          {(provided) => (
            <div 
              {...provided.droppableProps}
              ref={provided.innerRef}
              className="border rounded p-4 bg-white"
            >
              <div className="grid grid-cols-3 gap-4 mb-2 font-semibold bg-gray-50 p-2 rounded">
                <div>Number</div>
                <div>Value</div>
                <div>Source Group</div>
              </div>
              
              {items.map((item, index) => (
                <Draggable key={item.id} draggableId={item.id} index={index}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className="grid grid-cols-3 gap-4 border-b py-2 items-center hover:bg-gray-50"
                    >
                      <div className="font-mono">{item.number || 'Unmatched'}</div>
                      <div>{item.value}</div>
                      <div className="font-medium">
                        {item.source === 'unmatched' 
                          ? 'Unmatched' 
                          : `${baseNumber}.${item.source}`}
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
};

export default ExcelReader;