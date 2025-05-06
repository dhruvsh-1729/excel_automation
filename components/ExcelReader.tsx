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
  filteredItems: string[];
  generatedNumbers: string[];
};

type ItemWithSource = {
  id: string;
  value: string;
  source: string | 'unmatched';
  number?: string;
};

const ExcelReader = () => {
  // const [items, setItems] = useState<ItemWithSource[]>([]);
  const [groups, setGroups] = useState<FilterGroup[]>([]);
const [originalData, setOriginalData] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [nextGroupId, setNextGroupId] = useState(1);
  const [fileName, setFileName] = useState('');
  const [baseNumber, setBaseNumber] = useState('13');

 // derived computed values
const processedGroups = useMemo(() => {
  const remainingItems = new Set(originalData);

  const result = groups.map(group => {
    const filtered = Array.from(remainingItems).filter(item =>
      group.conditions.every(condition => {
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

    return {
      ...group,
      filteredItems: filtered,
      generatedNumbers: filtered.map((_, i) => `${baseNumber}.${group.id}.${i + 1}`)
    };
  });

  return result;
}, [groups, originalData, baseNumber]);

const items = useMemo(() => {
  return originalData.map((value, index) => {
    const matchedGroup = processedGroups.find(g => g.filteredItems.includes(value));
    return {
      id: `item-${index}-${value}`,
      value,
      source: matchedGroup?.id || 'unmatched',
      number: matchedGroup?.generatedNumbers[matchedGroup?.filteredItems.indexOf(value)]
    };
  });
}, [originalData, processedGroups]);

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

  const addGroup = () => {
    console.log('Adding new group with ID:', nextGroupId);
    
    const newId = nextGroupId.toString();
    const newGroup: FilterGroup = {
      id: newId,
      conditions: [{
        id: uuidv4(),
        type: 'contains',
        value: '',
        negate: false
      }],
      filteredItems: [],
      generatedNumbers: []
    };
  
    setGroups(prev => [...prev, newGroup]);
    setNextGroupId(prev => prev + 1);
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
    // Prepare the sheet data
    const sheetData: any[][] = [];
    const headerRow: string[] = [];

    const unmatchedItems = originalData.filter(item => 
      !processedGroups.some(group => group.filteredItems.includes(item))
    );

    // Build headers: [empty, GroupName], [empty, GroupName], ..., [empty, Unmatched]
    processedGroups.forEach((group) => {
      headerRow.push('', `${baseNumber}.${group.id}`);
    });
    if(unmatchedItems.length > 0) {
      headerRow.push('', `${baseNumber}.${nextGroupId}`);
    }
    sheetData.push(headerRow);

    // Find the max number of rows needed (longest group or unmatched items)
    const maxRows = Math.max(
      ...processedGroups.map(group => group.filteredItems.length),
      originalData.filter(item => !processedGroups.some(group => group.filteredItems.includes(item))).length
    );

    // Fill in rows
    for (let i = 0; i < maxRows; i++) {
      const row: any[] = [];

      processedGroups.forEach(group => {
        const number = group.generatedNumbers[i] || '';
        const value = group.filteredItems[i] || '';
        row.push(number, value);
      });

      const unmatchedNumber = i < unmatchedItems.length ? `${baseNumber}.${nextGroupId}.${i + 1}` : '';
      const unmatchedValue = unmatchedItems[i] || '';
      row.push(unmatchedNumber, unmatchedValue);

      sheetData.push(row);
    }

    // Export the sheet
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, fileName || 'Sheet1');
    XLSX.writeFile(wb, `${fileName || 'Sheet 1'}.${format}`);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Advanced Excel Filter</h1>

      <div className="mb-4 flex items-center gap-4">
        <label className="block mb-2">
          File Name:
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="ml-2 p-2 border rounded"
            placeholder="Enter file name"
          />
        </label>
        <label className="block mb-2">
          Base Number:
          <input
            type="text"
            value={baseNumber}
            onChange={(e) => setBaseNumber(e.target.value)}
            className="ml-2 p-2 border rounded"
            placeholder="Enter base number"
          />
        </label>
        <div className="">
        <label className="bg-blue-500 text-white px-4 py-2 rounded cursor-pointer hover:bg-blue-600">
          Upload Excel File
          <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleFile} />
        </label>
      {error && <p className="text-red-500 mb-4">{error}</p>}
      </div>
      <button 
          onClick={addGroup}
          className="bg-green-500 text-white px-4 py-2 rounded mr-4 cursor-pointer hover:bg-green-600"
        >
          Add New Group
        </button>
        <div className="">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => exportData('xlsx')}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
          >
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
      </div>
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